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
  let loadFailed = false;
  try {
    data = await adminDashboard(actor);
  } catch (err) {
    console.error("[admin dashboard] load failed", err);
    loadFailed = true;
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
        <Button className="shadow-glow" nativeButton={false} render={<Link href="/admin/generate" />}>
          <SparklesIcon data-icon="inline-start" />
          New exam
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      {loadFailed && (
        <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Dashboard metrics failed to load — figures below may be stale or zero.
          Try refreshing the page.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard title="Students" value={data?.studentCount ?? 0} accent />
        <KpiCard title="Exams created" value={data?.examCount ?? 0} />
        <KpiCard title="Attempts" value={data?.attemptsTotal ?? 0} />
        <KpiCard
          title="Average score"
          value={data?.averageScore ?? 0}
          suffix="%"
          hint="Across graded attempts"
        />
        <KpiCard title="Retakes" value={data?.retakesTotal ?? 0} hint={data?.retakeRate !== null ? `${data?.retakeRate}% of attempts` : "No retakes"} />
        <KpiCard title="Retake rate" value={data?.retakeRate ?? 0} suffix="%" hint="Approved retakes" />
      </div>

      {(data?.retakesByExam?.length ?? 0) > 0 && (
        <div className="shadow-card rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold">Retakes per exam</h3>
          <p className="text-muted-foreground text-xs mt-1">Approved retakes — per exam with unique students (tap for detail)</p>
          <div className="mt-3 flex flex-col divide-y">
            {data!.retakesByExam.slice(0, 8).map((r) => (
              <Link key={r.examId} href={`/admin/exams/${r.examId}`} className="flex items-center justify-between py-2.5 hover:bg-accent/20 -mx-2 px-2 rounded-lg">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-muted-foreground text-xs">{r.subject} · {r.uniqueRetakers} student{r.uniqueRetakers !== 1 ? "s" : ""} retook{ r.avgImprovement !== null ? ` · avg ${r.avgImprovement > 0 ? "+" : ""}${r.avgImprovement}% improvement` : ""}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums">{r.count}</p>
              </Link>
            ))}
          </div>
        </div>
      )}

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

      {(data?.perExamDetailed?.length ?? 0) > 0 && (
        <div className="shadow-card rounded-xl border bg-card">
          <div className="p-5 pb-2">
            <h3 className="text-sm font-semibold">Detailed assessment per exam</h3>
            <p className="text-muted-foreground text-xs mt-1">Results, retakes and question-level fail/skip rates — per exam</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs border-y bg-muted/20">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Exam</th>
                  <th className="text-right px-3 py-2.5 font-medium">Attempts</th>
                  <th className="text-right px-3 py-2.5 font-medium">Avg</th>
                  <th className="text-right px-3 py-2.5 font-medium">Retakes</th>
                  <th className="text-left px-4 py-2.5 font-medium">Top failed questions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data!.perExamDetailed.map((e) => (
                  <tr key={e.examId} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <Link href={`/admin/exams/${e.examId}`} className="font-medium truncate max-w-52 block hover:underline">{e.title}</Link>
                      <p className="text-muted-foreground text-xs">{e.subject} · {e.gradedCount} graded</p>
                    </td>
                    <td className="text-right px-3 py-3 tabular-nums">{e.totalAttempts}</td>
                    <td className="text-right px-3 py-3 tabular-nums">{e.avgScore !== null ? `${e.avgScore}%` : "—"}</td>
                    <td className="text-right px-3 py-3 tabular-nums">{e.retakeCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 max-w-80">
                        {e.failedQuestionRates.slice(0, 3).map((q) => (
                          <div key={q.questionId} className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate">{q.prompt.slice(0, 48)}</span>
                            <span className="shrink-0 tabular-nums text-amber-600">{q.failRate}% fail · {q.skippedRate}% skip</span>
                          </div>
                        ))}
                        {e.failedQuestionRates.length === 0 && <span className="text-muted-foreground text-xs">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
