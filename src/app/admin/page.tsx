export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { adminDashboard } from "@/server/services/analytics";
import { Button } from "@/components/ui/button";
import {
  ChartCard,
  CategoryBars,
  KpiCard,
} from "@/components/features/dashboard/charts";
import { formatTokens } from "@/lib/pricing";

export default async function AdminHomePage() {
  const actor = await requireRole("admin");

  let data: Awaited<ReturnType<typeof adminDashboard>> | null = null;
  try {
    data = await adminDashboard(actor);
  } catch (err) {
    console.error("[admin dashboard] load failed", err);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {actor.schoolId ? "Your school at a glance." : "Your students at a glance."}
          </p>
        </div>
        <Button className="shadow-glow" render={<Link href="/admin/generate" />}>
          <SparklesIcon data-icon="inline-start" />
          New exam
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Students" value={data?.studentCount ?? 0} accent />
        <KpiCard title="Exams created" value={data?.examCount ?? 0} />
        <KpiCard title="Attempts" value={data?.attemptsTotal ?? 0} />
        <KpiCard
          title="Average score"
          value={data?.averageScore ?? 0}
          suffix="%"
          hint="Across graded attempts"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Exam activity" description="Submissions over the last 14 days">
          {(data?.attemptsByDay?.length ?? 0) > 1 ? (
            <CategoryBars
              data={data!.attemptsByDay}
              xKey="date"
              yKey="attempts"
              label="Submissions"
            />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Activity appears once students start submitting.
            </p>
          )}
        </ChartCard>
        <ChartCard title="Exams by subject" description="What you've generated">
          {(data?.bySubject?.length ?? 0) > 0 ? (
            <CategoryBars
              data={data!.bySubject}
              xKey="subject"
              yKey="attempts"
              label="Attempts"
              vertical
            />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Generate your first exam to see subject coverage.
            </p>
          )}
        </ChartCard>
      </div>

      <div className="shadow-card grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-sm">Wallet balance</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatTokens(data?.walletBalance ?? 0)}{" "}
            <span className="text-muted-foreground text-sm font-normal">tokens</span>
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-sm">Tokens consumed</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {formatTokens(data?.tokensConsumed ?? 0)}
          </p>
        </div>
      </div>
    </div>
  );
}
