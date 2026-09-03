import { mathifyCell, repairMath } from "@/lib/exam/latex";
import type { Question } from "@/types/firestore";

/** Largest JSON payload a single visual may occupy before it's dropped. */
const MAX_VISUAL_JSON_CHARS = 4_000;

/**
 * Longest hint, explanation or worked example we will store.
 *
 * The AI contract deliberately leaves these unbounded (a bound there rejects the
 * whole chunk — see `examOutputSchema`), so the ceiling lives here, where going
 * over costs the tail of one field. Generous next to the ~80-word worked example
 * the prompt asks for: this is a backstop, not the spec.
 */
const MAX_PROSE_CHARS = 1_200;

/**
 * Reject a visual large enough to threaten the 1 MiB document ceiling once many
 * questions carry one. Losing a chart beats losing the exam.
 *
 * Measured *after* trimming. This used to run on the raw model output, before
 * `sanitizeVisual` clipped cells to 100 chars and capped rows at 12 and headers
 * at 8 — so a wordy but perfectly salvageable table was dropped for a bulk that
 * no longer existed by the time anything was written.
 */
function withinSizeCap(clean: Record<string, unknown>): Question["visual"] {
  try {
    if (JSON.stringify(clean).length > MAX_VISUAL_JSON_CHARS) return null;
  } catch {
    return null; // circular or otherwise unserializable — Firestore would reject it too
  }
  return clean as Question["visual"];
}

/**
 * Find where a field stops saying something and starts repeating itself, or null
 * if it never does.
 *
 * Turning off constrained decoding made the repetition loop rare, not impossible,
 * and a loop that terminates on its own is the dangerous shape: it parses, it
 * validates, and it persists. One observed worked example ran to 14,740 characters
 * of `pi over 12, 5 pi over 12, and pi over 2 directly without extraneous roots in
 * range` repeated verbatim — which a student would have been shown.
 *
 * The test is deliberately hard to trip: half the field or more has to be
 * verbatim repeats of one 60-character window, which no real explanation does but
 * a collapse always does (its coverage runs 0.7–1.0). The index returned is the
 * *second* occurrence, so the caller keeps the part that was still saying
 * something — in that example, a correct derivation — and drops the rest.
 */
function repetitionCut(text: string): number | null {
  const WINDOW = 60;
  if (text.length < 400) return null;
  for (let i = 0; i + WINDOW <= text.length; i += WINDOW) {
    const probe = text.slice(i, i + WINDOW);
    const hits: number[] = [];
    for (let at = text.indexOf(probe); at !== -1; at = text.indexOf(probe, at + WINDOW)) {
      hits.push(at);
    }
    if (hits.length >= 3 && (hits.length * WINDOW) / text.length >= 0.5) return hits[1]!;
  }
  return null;
}

/**
 * Narrow an AI-supplied free-text field to something worth storing: dropped if
 * absent, cut where it starts looping, capped at `MAX_PROSE_CHARS`.
 */
export function clampProse(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  const cut = repetitionCut(text);
  if (cut !== null) text = text.slice(0, cut).trimEnd();
  if (text.length > MAX_PROSE_CHARS) text = `${text.slice(0, MAX_PROSE_CHARS).trimEnd()}…`;
  return text || null;
}

/**
 * `clampProse`, then LaTeX repair — in that order, because both cuts above land
 * at an arbitrary character and can fall inside a `$…$` span or a `\begin{cases}`
 * block. Repairing first and truncating second would reintroduce exactly the
 * unbalanced maths this is here to prevent.
 */
export function repairProse(value: unknown): string | null {
  const text = clampProse(value);
  return text === null ? null : repairMath(text) || null;
}

/**
 * Narrow an AI-supplied visual to something Firestore will accept and the
 * renderer can trust. Returns null whenever the payload isn't worth persisting.
 */
export function sanitizeVisual(v: unknown): Question["visual"] {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const isValidKey = (k: string) =>
    k.trim() !== "" &&
    !k.includes("/") &&
    !k.includes("*") &&
    !k.includes("[") &&
    !k.includes("]") &&
    !k.includes("~") &&
    !k.includes(".") &&
    !k.startsWith("__");
  if (obj.kind === "chart") {
    const chartType = obj.chartType as string;
    if (!["bar", "line", "pie", "area"].includes(chartType)) return null;
    const data = Array.isArray(obj.data) ? obj.data as Array<Record<string, unknown>> : [];
    const cleanData = data
      .slice(0, 12)
      .map((row) => {
        const out: Record<string, string | number> = {};
        for (const [k, val] of Object.entries(row as Record<string, unknown>)) {
          if (!isValidKey(k)) continue;
          if (typeof val === "string" && val.trim() !== "") out[k] = val.trim().slice(0, 80);
          else if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
          else if (val !== undefined && val !== null) {
            const s = String(val).trim();
            if (s) out[k] = s.slice(0, 80);
          }
        }
        return out;
      })
      .filter((r) => Object.keys(r).length >= 2);
    if (cleanData.length < 2) return null;
    const clean: Record<string, unknown> = { kind: "chart", chartType, data: cleanData };
    if (typeof obj.title === "string" && obj.title.trim()) clean.title = obj.title.trim().slice(0, 120);
    if (typeof obj.caption === "string" && obj.caption.trim()) clean.caption = obj.caption.trim().slice(0, 300);
    if (typeof obj.xKey === "string" && obj.xKey.trim() && isValidKey(obj.xKey.trim())) clean.xKey = obj.xKey.trim();
    if (typeof obj.yKey === "string" && obj.yKey.trim() && isValidKey(obj.yKey.trim())) clean.yKey = obj.yKey.trim();
    return withinSizeCap(clean);
  }
  if (obj.kind === "table") {
    // `mathifyCell` is applied *after* the length cap on purpose. A header such
    // as `\sum x^2` is notation the model wrote without delimiters, and the
    // renderer has no way to tell it apart from prose — so it reached students as
    // literal backslashes. Wrapping it here costs a few characters over the cap,
    // which is markup rather than content, and the whole visual is still measured
    // against `MAX_VISUAL_JSON_CHARS` below.
    const headers = Array.isArray(obj.headers)
      ? (obj.headers as unknown[])
          .filter((h): h is string => typeof h === "string" && h.trim() !== "")
          .slice(0, 8)
          .map((h) => mathifyCell(h.slice(0, 100)) || h.trim())
      : [];
    if (headers.length < 2) return null;
    // Each row is rewrapped as `{ cells }`: Firestore rejects an array whose
    // elements are arrays, and these rows sit inside the `questions` array.
    // Cells are coerced and padded to `headers.length` rather than filtered —
    // dropping one would shift every later column left and desync the row from
    // its headers. An already-wrapped row is accepted so this stays idempotent.
    const rows = (Array.isArray(obj.rows) ? (obj.rows as unknown[]) : [])
      .slice(0, 12)
      .map((r) => {
        const raw = Array.isArray(r)
          ? (r as unknown[])
          : Array.isArray((r as { cells?: unknown } | null)?.cells)
            ? (r as { cells: unknown[] }).cells
            : null;
        if (!raw) return null;
        const cells = Array.from({ length: headers.length }, (_, i) => {
          const cell = raw[i];
          if (cell === undefined || cell === null) return "";
          const text = String(cell).trim().slice(0, 100);
          return mathifyCell(text) || text;
        });
        return cells.some((c) => c !== "") ? { cells } : null;
      })
      .filter((r): r is { cells: string[] } => r !== null);
    if (rows.length === 0) return null;
    const clean: Record<string, unknown> = { kind: "table", headers, rows };
    if (typeof obj.title === "string" && obj.title.trim()) clean.title = obj.title.trim().slice(0, 120);
    if (typeof obj.caption === "string" && obj.caption.trim()) clean.caption = obj.caption.trim().slice(0, 300);
    return withinSizeCap(clean);
  }
  return null;
}
