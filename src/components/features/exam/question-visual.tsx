"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { QuestionVisual } from "@/types/firestore";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

function inferKeys(data: Array<Record<string, string | number>>, xKey?: string, yKey?: string) {
  const first = data[0] ?? {};
  const keys = Object.keys(first);
  const numericKeys = keys.filter((k) => typeof first[k] === "number");
  const stringKeys = keys.filter((k) => typeof first[k] === "string");
  const resolvedX = xKey && keys.includes(xKey) ? xKey : stringKeys[0] ?? keys[0] ?? "label";
  const resolvedY = yKey && keys.includes(yKey) ? yKey : numericKeys[0] ?? keys.find((k) => k !== resolvedX) ?? "value";
  return { xKey: resolvedX, yKey: resolvedY };
}

function ChartVisual({ visual }: { visual: Extract<QuestionVisual, { kind: "chart" }> }) {
  const { chartType, title, caption, data, xKey, yKey } = visual;
  const { xKey: rx, yKey: ry } = inferKeys(data as Array<Record<string, string | number>>, xKey, yKey);
  const config = {
    [ry]: { label: ry, color: "hsl(var(--primary))" },
  } as Record<string, { label: string; color: string }>;

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card sm:p-5">
      {title && <p className="text-sm font-semibold tracking-tight">{title}</p>}
      <ChartContainer config={config} className="mt-3 aspect-16/10 max-h-80 w-full sm:aspect-18/10">
        {chartType === "bar" ? (
          <BarChart data={data as unknown as Record<string, string | number>[]}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={rx} tick={{ fontSize: 11 }} interval={0} angle={data.length > 6 ? -20 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 44 : 28} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            <Bar dataKey={ry} fill="var(--color-value, hsl(var(--primary)))" radius={[6, 6, 0, 0]} maxBarSize={44} />
          </BarChart>
        ) : chartType === "line" ? (
          <LineChart data={data as unknown as Record<string, string | number>[]}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={rx} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            <Line type="monotone" dataKey={ry} stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        ) : chartType === "area" ? (
          <AreaChart data={data as unknown as Record<string, string | number>[]}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis dataKey={rx} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            <Area type="monotone" dataKey={ry} stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.18)" strokeWidth={2} />
          </AreaChart>
        ) : (
          <PieChart>
            <Tooltip content={<ChartTooltipContent />} />
            <Legend />
            <Pie data={data as unknown as Record<string, string | number>[]} dataKey={ry} nameKey={rx} cx="50%" cy="50%" outerRadius={88} label>
              {(data as unknown as Record<string, string | number>[]).map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ChartContainer>
      {caption && <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{caption}</p>}
    </div>
  );
}

/**
 * Rows persist as `{ cells }` maps because Firestore rejects an array of arrays.
 * A bare `string[]` is still accepted so a row written by a different deploy —
 * or pasted straight from an AI response — renders instead of crashing.
 */
function rowCells(row: { cells?: string[] } | string[] | null | undefined): string[] {
  if (Array.isArray(row)) return row;
  return Array.isArray(row?.cells) ? row.cells : [];
}

function TableVisual({ visual }: { visual: Extract<QuestionVisual, { kind: "table" }> }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
      {(visual.title || visual.caption) && (
        <div className="border-b bg-muted/20 px-4 py-3">
          {visual.title && <p className="text-sm font-semibold">{visual.title}</p>}
          {visual.caption && <p className="text-muted-foreground mt-0.5 text-xs">{visual.caption}</p>}
        </div>
      )}
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/10">
              {visual.headers.map((h) => (
                <TableHead key={h} className="whitespace-nowrap text-xs font-semibold">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visual.rows.map((row, i) => (
              <TableRow key={i} className={i % 2 === 0 ? "bg-card" : "bg-muted/20"}>
                {rowCells(row).map((cell, j) => (
                  <TableCell key={j} className="whitespace-nowrap text-sm">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function QuestionVisualView({ visual }: { visual: QuestionVisual | null | undefined }) {
  if (!visual) return null;
  if (visual.kind === "chart") return <ChartVisual visual={visual} />;
  if (visual.kind === "table") return <TableVisual visual={visual} />;
  return null;
}
