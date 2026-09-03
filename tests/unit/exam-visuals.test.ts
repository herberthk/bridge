import { describe, expect, it } from "vitest";

import { sanitizeVisual } from "@/server/services/exams";

/**
 * Firestore rejects an array whose elements are themselves arrays
 * (`INVALID_ARGUMENT: Property array contains an invalid nested entity`), and a
 * question's visual is nested inside the exam's `questions` array — so one
 * `string[][]` fails the entire exam write. This walks the sanitized output the
 * way the Firestore client does, asserting the rule structurally rather than
 * re-checking the one shape we happen to remember.
 */
function assertNoNestedArrays(value: unknown, path = "visual"): void {
  if (Array.isArray(value)) {
    value.forEach((el, i) => {
      expect(Array.isArray(el), `${path}[${i}] is an array inside an array`).toBe(false);
      assertNoNestedArrays(el, `${path}[${i}]`);
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoNestedArrays(v, `${path}.${k}`);
  }
}

type Table = Extract<NonNullable<ReturnType<typeof sanitizeVisual>>, { kind: "table" }>;
type Chart = Extract<NonNullable<ReturnType<typeof sanitizeVisual>>, { kind: "chart" }>;

const table = (rows: unknown, headers: unknown = ["Region", "Yield"]) =>
  sanitizeVisual({ kind: "table", headers, rows });

describe("sanitizeVisual: tables", () => {
  it("rewraps wire rows as `{ cells }` so the write is storable", () => {
    const out = table([
      ["North", "40"],
      ["South", "55"],
    ]) as Table;
    expect(out.rows).toEqual([{ cells: ["North", "40"] }, { cells: ["South", "55"] }]);
    assertNoNestedArrays(out);
  });

  it("accepts already-wrapped rows unchanged, so re-sanitizing is safe", () => {
    const once = table([["North", "40"]]) as Table;
    const twice = sanitizeVisual({ ...once }) as Table;
    expect(twice.rows).toEqual(once.rows);
  });

  it("pads a short row instead of leaving it ragged", () => {
    const out = table([["North"]], ["Region", "Yield", "Rank"]) as Table;
    expect(out.rows).toEqual([{ cells: ["North", "", ""] }]);
  });

  it("truncates a row that overruns the headers", () => {
    const out = table([["North", "40", "extra"]]) as Table;
    expect(out.rows).toEqual([{ cells: ["North", "40"] }]);
  });

  it("coerces a non-string cell rather than dropping it", () => {
    // Dropping the number would shift "high" left into the Yield column and
    // silently misreport the data the question is asking about.
    const out = table([["North", 40, "high"]], ["Region", "Yield", "Grade"]) as Table;
    expect(out.rows).toEqual([{ cells: ["North", "40", "high"] }]);
  });

  it("keeps a null cell in place as a blank", () => {
    const out = table([["North", null, "high"]], ["Region", "Yield", "Grade"]) as Table;
    expect(out.rows).toEqual([{ cells: ["North", "", "high"] }]);
  });

  it("trims and caps cell text at 100 chars", () => {
    const out = table([["  North  ", "y".repeat(140)]]) as Table;
    expect(out.rows[0]!.cells[0]).toBe("North");
    expect(out.rows[0]!.cells[1]).toHaveLength(100);
  });

  it("drops an entirely blank row", () => {
    const out = table([
      ["", ""],
      ["South", "55"],
    ]) as Table;
    expect(out.rows).toEqual([{ cells: ["South", "55"] }]);
  });

  it("caps at 12 rows and 8 headers", () => {
    const headers = Array.from({ length: 12 }, (_, i) => `h${i}`);
    const rows = Array.from({ length: 20 }, (_, i) => [`r${i}`, "x"]);
    const out = table(rows, headers) as Table;
    expect(out.headers).toHaveLength(8);
    expect(out.rows).toHaveLength(12);
    expect(out.rows[0]!.cells).toHaveLength(8);
  });

  it("returns null when there is nothing renderable", () => {
    expect(table([["North", "40"]], ["OnlyOne"])).toBeNull();
    expect(table([])).toBeNull();
    expect(table([[""], ["", ""]])).toBeNull();
    expect(table("not-an-array")).toBeNull();
    expect(sanitizeVisual({ kind: "table" })).toBeNull();
  });

  it("carries an optional title and caption, and omits blank ones", () => {
    const withMeta = sanitizeVisual({
      kind: "table",
      headers: ["A", "B"],
      rows: [["1", "2"]],
      title: "  Output per Unit  ",
      caption: "Source: sample",
    }) as Table;
    expect(withMeta.title).toBe("Output per Unit");
    expect(withMeta.caption).toBe("Source: sample");

    const blank = table([["1", "2"]]) as Table;
    // Firestore rejects `undefined` values, so absent optionals must be absent
    // keys rather than explicit `undefined`.
    expect("title" in blank).toBe(false);
    expect("caption" in blank).toBe(false);
  });
});

describe("sanitizeVisual: maths in table cells", () => {
  // A live paper shipped a "Bivariate Sample Statistics" table whose Statistic
  // column held `\sum x`, `\sum y`, `\sum x^2` — notation written without
  // delimiters into a column that was *about* notation. The renderer had no way
  // to tell it from prose, so students read the backslashes.
  it("wraps unmarked notation so the cell renders as maths", () => {
    const out = table(
      [
        [String.raw`\sum x`, "120"],
        [String.raw`\sum x^2`, "1840"],
      ],
      ["Statistic", "Value"],
    ) as Table;
    expect(out.rows[0]!.cells[0]).toBe(String.raw`$\sum x$`);
    expect(out.rows[1]!.cells[0]).toBe(String.raw`$\sum x^2$`);
  });

  it("wraps notation in a header too", () => {
    const out = table([["North", "40"]], [String.raw`\bar{x}`, "Yield"]) as Table;
    expect(out.headers[0]).toBe(String.raw`$\bar{x}$`);
    expect(out.headers[1]).toBe("Yield");
  });

  it("leaves plain labels, figures and percentages alone", () => {
    // The guard has to be conservative: sprinkling `$…$` over ordinary cells
    // would hand every table to KaTeX and make "40" a maths italic.
    const out = table(
      [["North", "40", "12.5%"]],
      ["Region", "Yield", "Share"],
    ) as Table;
    expect(out.rows[0]!.cells).toEqual(["North", "40", "12.5%"]);
  });

  it("escapes an alignment tab that would otherwise swallow the cell", () => {
    const out = table([[String.raw`\sum x & y`, "1"]]) as Table;
    expect(out.rows[0]!.cells[0]).toBe(String.raw`$\sum x \& y$`);
  });

  it("is idempotent, so re-sanitizing a stored visual is safe", () => {
    const once = table([[String.raw`\sum xy`, "560"]]) as Table;
    const twice = sanitizeVisual({ ...once }) as Table;
    expect(twice.rows).toEqual(once.rows);
    expect(twice.headers).toEqual(once.headers);
  });
});

describe("sanitizeVisual: size cap", () => {
  // The 4,000-char ceiling exists so ~50 visuals cannot push the exam document
  // past Firestore's 1 MiB limit. It used to be measured against the *raw* model
  // output, before rows were capped at 12, headers at 8 and cells at 100 chars —
  // so a verbose but entirely salvageable table was thrown away for a bulk that
  // no longer existed by the time anything was written.
  it("keeps a table that only exceeds the cap before trimming", () => {
    // Narrow but very long: 40 rows of moderate cells blow the cap in raw form
    // and land comfortably under it once the 12-row cap applies.
    const headers = ["Region", "Yield", "Rank", "Note"];
    const rows = Array.from({ length: 40 }, (_, i) =>
      Array.from({ length: 4 }, (_, c) => `row ${i} cell ${c} ${"pad ".repeat(10)}`),
    );
    expect(JSON.stringify({ kind: "table", headers, rows }).length).toBeGreaterThan(4_000);

    const out = table(rows, headers) as Table;
    expect(out).not.toBeNull();
    expect(out.rows).toHaveLength(12);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(4_000);
  });

  it("still drops a visual that is over the cap after trimming", () => {
    // 8 headers × 100 chars plus 12 rows × 8 cells × 100 chars is ~10k, so the
    // cap is reachable even post-trim and the guard is not dead code.
    const headers = Array.from({ length: 8 }, () => "h".repeat(200));
    const rows = Array.from({ length: 12 }, () =>
      Array.from({ length: 8 }, () => "c".repeat(200)),
    );
    expect(table(rows, headers)).toBeNull();
  });
});

describe("sanitizeVisual: charts", () => {
  const data = [
    { label: "2019", value: 40 },
    { label: "2020", value: 55 },
  ];

  it("keeps a well-formed chart and its axis keys", () => {
    const out = sanitizeVisual({
      kind: "chart",
      chartType: "bar",
      data,
      xKey: "label",
      yKey: "value",
    }) as Chart;
    expect(out.chartType).toBe("bar");
    expect(out.data).toEqual(data);
    expect(out.xKey).toBe("label");
    assertNoNestedArrays(out);
  });

  it("rejects an unknown chart type", () => {
    expect(sanitizeVisual({ kind: "chart", chartType: "radar", data })).toBeNull();
  });

  it("strips keys Firestore cannot use as field names", () => {
    // Dots, slashes, brackets, tildes, stars and `__`-prefixes are all illegal
    // in a Firestore field path.
    const out = sanitizeVisual({
      kind: "chart",
      chartType: "line",
      data: [
        { "a.b": 1, label: "x", value: 1 },
        { "a.b": 2, label: "y", value: 2 },
      ],
      xKey: "a.b",
    }) as Chart;
    expect(Object.keys(out.data[0]!)).toEqual(["label", "value"]);
    expect("xKey" in out).toBe(false);
  });

  it("needs at least two usable points", () => {
    expect(sanitizeVisual({ kind: "chart", chartType: "pie", data: [data[0]] })).toBeNull();
    expect(sanitizeVisual({ kind: "chart", chartType: "pie", data: [] })).toBeNull();
  });

  it("ignores malformed rows without dropping valid chart points", () => {
    const out = sanitizeVisual({
      kind: "chart",
      chartType: "bar",
      data: [null, undefined, "bad", 7, ["bad"], ...data],
    }) as Chart;
    expect(out.data).toEqual(data);
  });
});

describe("sanitizeVisual: unusable input", () => {
  it("returns null for anything that isn't a known visual", () => {
    expect(sanitizeVisual(null)).toBeNull();
    expect(sanitizeVisual(undefined)).toBeNull();
    expect(sanitizeVisual("table")).toBeNull();
    expect(sanitizeVisual({ kind: "diagram" })).toBeNull();
  });
});
