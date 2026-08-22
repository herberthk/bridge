"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/motion";

/** KPI stat card with animated counter. */
export function KpiCard({
  title,
  value,
  suffix,
  hint,
  accent,
}: {
  title: string;
  value: number;
  suffix?: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "bg-brand shadow-glow relative overflow-hidden rounded-xl p-5 text-primary-foreground"
          : "shadow-card rounded-xl border bg-card p-5"
      }
    >
      <p className={`text-sm ${accent ? "opacity-80" : "text-muted-foreground"}`}>{title}</p>
      <p className={`mt-1.5 text-3xl font-semibold tabular-nums ${accent ? "" : ""}`}>
        <AnimatedCounter value={value} />
        {suffix && <span className="ml-1 text-lg font-normal opacity-80">{suffix}</span>}
      </p>
      {hint && (
        <p className={`mt-1 text-xs ${accent ? "opacity-70" : "text-muted-foreground"}`}>
          {hint}
        </p>
      )}
    </div>
  );
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  fontSize: 11,
} as const;

export function TrendLine({
  data,
  xKey,
  yKey,
  label,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  label: string;
}) {
  const config: ChartConfig = {
    [yKey]: { label, color: "var(--chart-1)" },
  };
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <LineChart data={data} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis domain={[0, 100]} {...axisProps} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey={yKey}
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-1)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

export function CategoryBars({
  data,
  xKey,
  yKey,
  label,
  vertical = false,
  height = "h-56",
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  label: string;
  vertical?: boolean;
  height?: string;
}) {
  const config: ChartConfig = {
    [yKey]: { label, color: "var(--chart-2)" },
  };
  return (
    <ChartContainer config={config} className={`${height} w-full`}>
      <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ left: 4, right: 12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        {vertical ? (
          <>
            <XAxis type="number" {...axisProps} />
            <YAxis dataKey={xKey} type="category" width={110} {...axisProps} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} interval={0} angle={-20} height={50} textAnchor="end" />
            <YAxis type="number" {...axisProps} />
          </>
        )}
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey={yKey} fill="var(--chart-2)" radius={6} />
      </BarChart>
    </ChartContainer>
  );
}

export function RevenueArea({
  data,
  xKey,
  yKey,
  label,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  label: string;
}) {
  const config: ChartConfig = {
    [yKey]: { label, color: "var(--chart-1)" },
  };
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey={yKey}
          type="monotone"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#revFill)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
