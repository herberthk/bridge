export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { studentDashboard } from "@/server/services/analytics";
import { listStudentAttempts } from "@/server/services/attempts";
import { Button } from "@/components/ui/button";
import {
  ChartCard,
  CategoryBars,
  KpiCard,
  TrendLine,
} from "@/components/features/dashboard/charts";

export default async function StudentHomePage() {
  const actor = await requireRole("student");

  let data: Awaited<ReturnType<typeof studentDashboard>> | null = null;
  let upcoming: Awaited<ReturnType<typeof listStudentAttempts>> = [];
  let loadFailed = false;
  try {
    [data, upcoming] = await Promise.all([
      studentDashboard(actor),
      listStudentAttempts(actor),
    ]);
  } catch (err) {
    console.error("[student dashboard] load failed", err);
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Hi {actor.displayName.split(" ")[0]} 👋
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Here&apos;s how your learning is going.
          </p>
        </div>
        <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Your progress could not be loaded. Try refreshing the page.
        </p>
      </div>
    );
  }

  const nextExam = upcoming.find(
    (u) => u.attempt.status === "pending" || u.attempt.status === "in_progress",
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hi {actor.displayName.split(" ")[0]} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Here&apos;s how your learning is going.
        </p>
      </div>

      {nextExam && (
        <div className="gradient-border shadow-lifted flex flex-wrap items-center justify-between gap-4 rounded-xl p-5">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Up next
            </p>
            <p className="mt-1 truncate font-semibold">{nextExam.exam?.title ?? "Exam"}</p>
            <p className="text-muted-foreground text-sm">
              {nextExam.exam?.questionCount ?? "–"} questions ·{" "}
              {nextExam.exam?.durationMinutes ?? "–"} min · AI proctored
            </p>
          </div>
          <Button className="shadow-glow" nativeButton={false} render={<Link href={`/exam/${nextExam.attempt.id}`} />}>
            Start when ready
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard title="Exams taken" value={data?.taken ?? 0} accent />
        <KpiCard
          title="Average score"
          value={data?.averageScore ?? 0}
          suffix="%"
          hint={data?.strongest ? `Strongest: ${data.strongest}` : undefined}
        />
        <KpiCard title="Waiting for you" value={data?.pending ?? 0} hint="Assigned, not yet taken" />
        <KpiCard title="Retakes" value={data?.retakes ?? 0} hint={data?.retakes ? "Approved retakes" : "No retakes yet"} />
      </div>

      {(data?.retakesByExam?.length ?? 0) > 0 && (
        <div className="shadow-card rounded-xl border bg-card p-5">
          <h3 className="text-sm font-semibold">Retakes per exam</h3>
          <p className="text-muted-foreground text-xs mt-1">Approved retakes only — grouped by exam (tap for history)</p>
          <div className="mt-3 flex flex-col divide-y">
            {data!.retakesByExam.map((r) => (
              <Link key={r.examId} href={`/student/exams/${r.examId}`} className="flex items-center justify-between py-2.5 hover:bg-accent/20 -mx-2 px-2 rounded-lg">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-muted-foreground text-xs">{r.subject} · {r.count} retake{r.count !== 1 ? "s" : ""}{r.improvement !== null ? ` · ${r.improvement > 0 ? "+" : ""}${r.improvement}% vs first` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{r.count}</p>
                  {r.latestScore !== null && <p className="text-muted-foreground text-xs">{r.latestScore}% latest</p>}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Score trend" description="Your last 8 graded exams">
          {(data?.trend?.length ?? 0) > 1 ? (
            <TrendLine data={data!.trend} xKey="label" yKey="score" label="Score (%)" />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Take at least two graded exams to see your trend.
            </p>
          )}
        </ChartCard>
        <ChartCard title="Performance by subject" description="Average score per subject">
          {(data?.bySubject?.length ?? 0) > 0 ? (
            <CategoryBars
              data={data!.bySubject}
              xKey="subject"
              yKey="score"
              label="Average (%)"
              vertical
            />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Subject analytics appear after your first graded exam.
            </p>
          )}
        </ChartCard>
      </div>

      {data?.weakest && data.strongest !== data.weakest && (
        <p className="text-muted-foreground text-sm">
          💡 Focus your revision on <strong>{data.weakest}</strong> — ask your
          teacher for practice exams on that subject.
        </p>
      )}
    </div>
  );
}
