"use client";

import {
  CategoryBars,
  ChartCard,
  TrendLine,
} from "@/components/features/dashboard/charts";
import type { StudentDashboardData } from "@/server/services/analytics";

/**
 * Charts island — the only client JS on the student dashboard (recharts).
 * Dynamically imported with a skeleton fallback so the rest of the page
 * streams and interacts without waiting on the chart chunk.
 */
export function DashboardCharts({
  trend,
  trendDescription,
  bySubject,
}: {
  trend: StudentDashboardData["trend"];
  trendDescription: string;
  bySubject: StudentDashboardData["bySubject"];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Score trend" description={trendDescription}>
        {trend.length > 1 ? (
          <TrendLine data={trend} xKey="label" yKey="score" label="Score (%)" />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Take at least two graded exams to see your trend.
          </p>
        )}
      </ChartCard>
      <ChartCard title="Performance by subject" description="Average score per subject">
        {bySubject.length > 0 ? (
          <CategoryBars
            data={bySubject}
            xKey="subject"
            yKey="score"
            label="Average (%)"
            vertical
          />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Subject analytics appear after your first graded exam.
          </p>
        )}
      </ChartCard>
    </div>
  );
}
