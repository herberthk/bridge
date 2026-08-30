"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { Markdown } from "@/components/markdown";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mathifyCell, plainMath } from "@/lib/exam/latex";
import { cn } from "@/lib/utils";
import type { QuestionVisual, QuestionVisualChart, QuestionVisualTable } from "@/types/firestore";

/**
 * Series palette.
 *
 * These are the theme's own chart tokens. The previous list opened with
 * `hsl(var(--primary))`, which cannot work here: every colour in this design
 * system is `oklch(…)`, so `hsl(oklch(0.51 0.23 273))` is invalid CSS and the
 * browser silently dropped the fill — the first bar of every chart rendered in
 * Recharts' default green. The rest of the list was raw hex, which ignored the
 * theme entirely and did not respond to dark mode.
 */
const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * Colour for slice/series `i`.
 *
 * A pie may carry up to 12 slices against five tokens, so plain modulo would
 * give slices 1 and 6 the same fill. Mixing toward the card colour on each
 * further cycle keeps them distinguishable while staying inside the palette.
 */
function seriesColor(i: number): string {
  const base = SERIES[i % SERIES.length]!;
  const cycle = Math.floor(i / SERIES.length);
  if (cycle === 0) return base;
  return `color-mix(in oklab, ${base} ${cycle === 1 ? 60 : 38}%, var(--card))`;
}

/* ── data model ──────────────────────────────────────────────── */

const NUMERIC = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Reads a cell as a number, accepting the quoted form.
 *
 * The model is asked for numeric chart values and usually complies, but
 * `{"year":"2019","yield":"40"}` comes back often enough to matter — and a
 * string on a value axis plots as a category, so the chart drew flat.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/,/g, "");
  if (!NUMERIC.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** `total_yield` / `totalYield` → `Total yield`, for legends and tooltips. */
function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** Axis ticks are SVG text, so they get separators and a compact form, not KaTeX. */
function formatNumber(value: number): string {
  return Math.abs(value) >= 10_000 ? COMPACT.format(value) : PLAIN.format(value);
}

type ChartModel = {
  rows: Array<Record<string, string | number>>;
  xKey: string;
  series: string[];
  /** Longest x-axis label, which decides whether ticks have to be angled. */
  dense: boolean;
  yWidth: number;
  config: ChartConfig;
  summary: string;
};

/**
 * Resolves axis keys, coerces values and builds the tooltip/legend config.
 *
 * Two behaviours worth naming. A key is treated as a value column only when
 * *every* row parses as a number, so a column of mixed junk stays a label rather
 * than plotting as zero. And when the model names a `yKey`, that is the only
 * series drawn — it stated its intent. When it does not, every numeric column is
 * drawn, which is the case that used to lose data silently: `inferKeys` took the
 * first numeric key and the rest of the table simply never appeared.
 */
function buildModel(visual: QuestionVisualChart): ChartModel {
  const raw = Array.isArray(visual.data) ? visual.data : [];

  const keys: string[] = [];
  for (const row of raw) {
    for (const key of Object.keys(row ?? {})) if (!keys.includes(key)) keys.push(key);
  }

  const numericKeys = keys.filter((key) => {
    let seen = false;
    for (const row of raw) {
      const value = row?.[key];
      if (value === undefined || value === null || value === "") continue;
      if (toNumber(value) === null) return false;
      seen = true;
    }
    return seen;
  });

  const categorical = keys.filter((key) => !numericKeys.includes(key));
  const xKey =
    visual.xKey && keys.includes(visual.xKey) ? visual.xKey : (categorical[0] ?? keys[0] ?? "label");

  const declaredY = visual.yKey && keys.includes(visual.yKey) ? visual.yKey : null;
  let series = declaredY
    ? [declaredY]
    : numericKeys.filter((key) => key !== xKey).slice(0, SERIES.length);
  if (series.length === 0) series = keys.filter((key) => key !== xKey).slice(0, 1);
  if (series.length === 0) series = ["value"];

  const isPie = visual.chartType === "pie";
  const plotted = isPie ? series.slice(0, 1) : series;

  const rows = raw.map((row) => {
    const out: Record<string, string | number> = {};
    for (const key of keys) {
      const value = row?.[key];
      if (value === undefined || value === null) continue;
      if (plotted.includes(key)) {
        const n = toNumber(value);
        if (n !== null) {
          out[key] = n;
          continue;
        }
      }
      if (typeof value === "number") {
        out[key] = value;
        continue;
      }
      const text = String(value);
      // Category labels live in SVG text, where KaTeX cannot reach them, so any
      // notation is projected to real symbols here instead of reaching the axis
      // as `$\sum x^2$`.
      out[key] = /[$\\]/.test(text) ? plainMath(text) || text : text;
    }
    return out;
  });

  const xLabels = rows.map((row) => String(row[xKey] ?? ""));
  const longestX = xLabels.reduce((max, label) => Math.max(max, label.length), 0);

  const yLabels = rows.flatMap((row) =>
    plotted.map((key) => (typeof row[key] === "number" ? formatNumber(row[key] as number) : "")),
  );
  const longestY = yLabels.reduce((max, label) => Math.max(max, label.length), 1);

  const config: ChartConfig = {};
  if (isPie) {
    // Pie legend and tooltip are keyed on the slice name, so each name needs its
    // own entry — otherwise every slice reads with the same label.
    for (const label of xLabels) if (label) config[label] = { label };
  } else {
    for (const key of plotted) config[key] = { label: humanize(key) };
  }

  const seriesNames = plotted.map(humanize).join(", ");
  const points = rows
    .slice(0, 12)
    .map((row) => {
      const values = plotted
        .map((key) => (row[key] === undefined ? "—" : String(row[key])))
        .join(" / ");
      return `${row[xKey] ?? "?"}: ${values}`;
    })
    .join("; ");
  const summary =
    `${visual.chartType} chart` +
    `${seriesNames ? ` of ${seriesNames}` : ""}` +
    `${xKey ? ` by ${humanize(xKey)}` : ""}. ${points}.`;

  return {
    rows,
    xKey,
    series: plotted,
    dense: rows.length > 6 || longestX > 8,
    yWidth: Math.min(76, 26 + longestY * 7),
    config,
    summary,
  };
}

/* ── chart ───────────────────────────────────────────────────── */

const GRID = { strokeDasharray: "3 3", className: "stroke-border/50" } as const;

function axisProps(model: ChartModel) {
  return {
    dataKey: model.xKey,
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
    interval: 0 as const,
    angle: model.dense ? -25 : 0,
    textAnchor: model.dense ? ("end" as const) : ("middle" as const),
    height: model.dense ? 52 : 26,
    tickMargin: 6,
  };
}

function valueAxisProps(model: ChartModel) {
  return {
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
    width: model.yWidth,
    tickFormatter: (value: number) => formatNumber(value),
  };
}

function pieSliceLabel({ percent }: { percent?: number }): string {
  const share = percent ?? 0;
  // Below ~6% the label collides with its neighbours; the legend still names it.
  return share >= 0.06 ? `${Math.round(share * 100)}%` : "";
}

function ChartVisual({ visual }: { visual: QuestionVisualChart }) {
  const model = useMemo(() => buildModel(visual), [visual]);
  const { chartType, title, caption } = visual;
  const { rows, xKey, series, config } = model;
  const showLegend = series.length > 1 || chartType === "pie";

  return (
    <figure className="my-3 rounded-2xl border bg-card p-4 shadow-card sm:p-5">
      {title && (
        <Markdown className="text-sm font-semibold tracking-tight [&_p]:m-0">{title}</Markdown>
      )}
      {/* The SVG carries no meaning for a screen reader, so the subtree is one
          image labelled with the data it plots. */}
      <div role="img" aria-label={model.summary}>
        <ChartContainer
          config={config}
          className="mt-3 aspect-16/10 max-h-80 w-full sm:aspect-18/10"
        >
          {chartType === "bar" ? (
            <BarChart data={rows} barGap={2} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis {...axisProps(model)} />
              <YAxis {...valueAxisProps(model)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {showLegend && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={seriesColor(i)}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={series.length > 1 ? 32 : 46}
                />
              ))}
            </BarChart>
          ) : chartType === "line" ? (
            <LineChart data={rows} margin={{ left: 0, right: 8, top: 6 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis {...axisProps(model)} />
              <YAxis {...valueAxisProps(model)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {showLegend && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(i)}
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: seriesColor(i) }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          ) : chartType === "area" ? (
            <AreaChart data={rows} margin={{ left: 0, right: 8, top: 6 }}>
              <defs>
                {series.map((key, i) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={seriesColor(i)} stopOpacity={0.32} />
                    <stop offset="100%" stopColor={seriesColor(i)} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis {...axisProps(model)} />
              <YAxis {...valueAxisProps(model)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              {showLegend && <ChartLegend content={<ChartLegendContent />} />}
              {series.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={seriesColor(i)}
                  strokeWidth={2}
                  fill={`url(#fill-${key})`}
                  stackId={series.length > 1 ? "a" : undefined}
                />
              ))}
            </AreaChart>
          ) : (
            <PieChart margin={{ top: 4, bottom: 4 }}>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey={xKey} />} />
              <ChartLegend content={<ChartLegendContent nameKey={xKey} className="flex-wrap" />} />
              <Pie
                data={rows}
                dataKey={series[0]!}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius="78%"
                paddingAngle={1}
                stroke="var(--card)"
                strokeWidth={2}
                label={pieSliceLabel}
                labelLine={false}
              >
                {rows.map((row, i) => (
                  <Cell key={String(row[xKey] ?? i)} fill={seriesColor(i)} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ChartContainer>
      </div>
      {caption && (
        <figcaption className="text-muted-foreground mt-2 text-xs leading-relaxed">
          <Markdown className="[&_p]:m-0">{caption}</Markdown>
        </figcaption>
      )}
    </figure>
  );
}

/* ── table ───────────────────────────────────────────────────── */

/**
 * Rows persist as `{ cells }` maps because Firestore rejects an array of arrays.
 * A bare `string[]` is still accepted so a row written by a different deploy —
 * or pasted straight from an AI response — renders instead of crashing.
 */
function rowCells(row: { cells?: string[] } | string[] | null | undefined): string[] {
  if (Array.isArray(row)) return row;
  return Array.isArray(row?.cells) ? row.cells : [];
}

/** Counts, money and percentages, which belong right-aligned under their header. */
const NUMERIC_CELL = /^[-+(]?\s*[$£€]?\s*\d[\d,\s]*(?:\.\d+)?\s*%?\)?$/;

/** Content that has to go through the markdown/KaTeX pipeline rather than as text. */
const NEEDS_MARKDOWN = /[$`*]|\\[a-zA-Z]/;

/**
 * One header or cell.
 *
 * `mathifyCell` is the fix for the bivariate-statistics table that reached
 * students with `\sum x`, `\sum y`, `\sum x^2` printed as literal characters:
 * the column was *about* notation, so the model wrote notation, and a raw string
 * renderer has no way to know. Plain cells deliberately skip the markdown pass —
 * a 12 × 8 table would otherwise mount ninety-six parsers to render numbers.
 */
function CellText({ value }: { value: string }) {
  const text = mathifyCell(value);
  if (!text) return null;
  if (!NEEDS_MARKDOWN.test(text)) return text;
  return <Markdown className="[&_p]:m-0">{text}</Markdown>;
}

function TableVisual({ visual }: { visual: QuestionVisualTable }) {
  const { headers, rows, numeric } = useMemo(() => {
    const head = Array.isArray(visual.headers) ? visual.headers : [];
    const body = (Array.isArray(visual.rows) ? visual.rows : []).map(rowCells);
    // Alignment is decided per column, not per cell: a column reads as a column
    // of figures only when every value in it is one.
    const numericCols = head.map((_, col) => {
      const values = body.map((row) => (row[col] ?? "").trim()).filter(Boolean);
      return values.length > 0 && values.every((value) => NUMERIC_CELL.test(value));
    });
    return { headers: head, rows: body, numeric: numericCols };
  }, [visual]);

  if (headers.length === 0 || rows.length === 0) return null;

  return (
    <figure className="my-3 overflow-hidden rounded-2xl border bg-card shadow-card">
      {(visual.title || visual.caption) && (
        <div className="border-b bg-muted/20 px-4 py-3">
          {visual.title && (
            <Markdown className="text-sm font-semibold tracking-tight [&_p]:m-0">
              {visual.title}
            </Markdown>
          )}
          {visual.caption && (
            <div className="text-muted-foreground mt-0.5 text-xs">
              <Markdown className="[&_p]:m-0">{visual.caption}</Markdown>
            </div>
          )}
        </div>
      )}
      {/* `Table` supplies its own horizontal scroll container. */}
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            {headers.map((header, col) => (
              <TableHead
                key={col}
                scope="col"
                className={cn(
                  "text-foreground align-bottom text-xs font-semibold",
                  numeric[col] && "text-right",
                )}
              >
                <CellText value={header} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((cells, row) => (
            <TableRow
              key={row}
              className={cn(
                "border-0 hover:bg-accent/30",
                row % 2 === 1 && "bg-muted/20 hover:bg-accent/30",
              )}
            >
              {headers.map((_, col) => (
                <TableCell
                  key={col}
                  className={cn(
                    "align-top text-sm",
                    numeric[col]
                      ? "text-right tabular-nums whitespace-nowrap"
                      : // Cells run to 100 characters, so prose has to be allowed
                        // to wrap rather than widen the table off the phone.
                        "max-w-[22ch] whitespace-normal",
                  )}
                >
                  <CellText value={cells[col] ?? ""} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </figure>
  );
}

export function QuestionVisualView({ visual }: { visual: QuestionVisual | null | undefined }) {
  if (!visual) return null;
  if (visual.kind === "chart") return <ChartVisual visual={visual} />;
  if (visual.kind === "table") return <TableVisual visual={visual} />;
  return null;
}
