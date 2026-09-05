import dynamic from "next/dynamic";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookOpenCheckIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  FileCheck2Icon,
  FlameIcon,
  GraduationCapIcon,
  HistoryIcon,
  LightbulbIcon,
  LineChartIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  TimerIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";

import type { StudentDashboardData } from "@/server/services/analytics";
import type { StudentAttemptWithExam } from "@/server/services/attempts";
import type { StudentRetakeRequest } from "@/server/services/retakes";
import type { StudentClassStanding } from "@/server/services/leaderboard";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import { parseDate } from "@/lib/serialize";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartSkeleton } from "@/components/features/dashboard/skeletons";

/** Charts are the only client JS here — split off so the page streams without them. */
const DashboardCharts = dynamic(
  () => import("./dashboard-charts").then((m) => m.DashboardCharts),
  {
    loading: () => (
      <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    ),
  },
);

// ─── Small pure helpers ───────────────────────────────────────────────────────

function subjectOf(code: string): string {
  return SUBJECT_LABELS[code as Subject] ?? code;
}

function dateOf(value: unknown, pattern = "d MMM yyyy"): string | null {
  const d = parseDate(value);
  return d ? format(d, pattern) : null;
}

function scoreTone(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function scoreBar(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

// ─── KPI tile (static numerals — zero JS by design) ───────────────────────────

function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  iconClass,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  iconClass?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-5",
        accent
          ? "bg-brand bg-noise text-white shadow-glow ring-1 ring-white/20"
          : "border bg-card shadow-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            accent ? "bg-white/15 text-white" : iconClass,
          )}
        >
          <Icon className="size-4" />
        </span>
        <p className={cn("text-[13px] font-medium", accent ? "opacity-80" : "text-muted-foreground")}>
          {label}
        </p>
      </div>
      <p className="mt-2.5 truncate text-3xl font-bold tabular-nums">{value}</p>
      {hint && (
        <p className={cn("mt-1 truncate text-xs", accent ? "opacity-70" : "text-muted-foreground")}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Main dashboard (server component — no client JS except charts island) ────

export function StudentDashboard({
  firstName,
  todayLabel,
  data,
  attempts,
  requests,
  standing,
  degraded,
}: {
  firstName: string;
  todayLabel: string;
  data: StudentDashboardData | null;
  attempts: StudentAttemptWithExam[];
  requests: StudentRetakeRequest[];
  standing: StudentClassStanding | null;
  degraded: boolean;
}) {
  const queue = attempts.filter(
    ({ attempt }) => attempt.status === "pending" || attempt.status === "in_progress",
  );
  const nextExam =
    queue.find(({ attempt }) => attempt.status === "in_progress") ?? queue[0] ?? null;
  const gradedAll = attempts.filter(({ attempt }) => attempt.score !== null);
  const recent = gradedAll.slice(0, 5);
  const isNew = attempts.length === 0;

  const taken = data?.taken ?? gradedAll.length;
  const average =
    data?.averageScore ??
    (gradedAll.length
      ? Math.round(
          gradedAll.reduce((n, { attempt }) => n + attempt.score!.percentage, 0) / gradedAll.length,
        )
      : null);

  const trend = data?.trend ?? [];
  const trendDelta =
    trend.length > 1 ? trend[trend.length - 1]!.score - trend[0]!.score : null;

  // "Grading" means genuinely awaiting grades — stranded pre-fix docs already
  // carry a score and read as Graded on their results page.
  const gradingNow = attempts.filter(
    ({ attempt }) => attempt.status === "submitted" && attempt.score === null,
  );
  const underReview = attempts.filter(({ attempt }) => attempt.status === "flagged");
  const openRetakes = queue.filter(({ attempt }) => attempt.retakeOf);
  const pendingRequests = requests.filter((r) => r.status === "pending");

  const headerSub =
    queue.length > 0
      ? `${queue.length} exam${queue.length !== 1 ? "s" : ""} waiting — start with “${nextExam?.exam?.title ?? "your next exam"}”.`
      : taken > 0
        ? "All caught up — your latest results are below."
        : "Your learning home — assigned exams will appear here.";

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* ── Header ── */}
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          {todayLabel}
          {standing ? ` · ${standing.className}` : ""}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1.5 max-w-2xl truncate text-sm text-muted-foreground sm:text-[15px]">
          {headerSub}
        </p>
      </div>

      {degraded && (
        <p className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Some sections couldn&apos;t load — showing what&apos;s available. Refresh to retry.
        </p>
      )}

      {isNew ? (
        /* ── Brand-new student ── */
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-dashed bg-card/60 px-6 py-12 text-center sm:py-16">
          <div className="bg-brand flex size-14 items-center justify-center rounded-2xl text-white shadow-glow">
            <GraduationCapIcon className="size-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Nothing here yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-pretty text-muted-foreground">
              When your teacher assigns an exam it shows up here. Here&apos;s how it works:
            </p>
          </div>
          <ol className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
            {[
              { icon: ClipboardListIcon, title: "1. Get assigned", text: "Exams appear with a date and duration." },
              { icon: TimerIcon, title: "2. Sit the exam", text: "Timed and proctored, right in your browser." },
              { icon: LineChartIcon, title: "3. See results", text: "Scores, feedback and full review." },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-2xl border bg-card p-4 shadow-card">
                <Icon className="size-5 text-primary" />
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
          <Button nativeButton={false} render={<Link href="/student/exams" />} className="shadow-glow">
            <BookOpenCheckIcon data-icon="inline-start" />
            View my exams
          </Button>
        </div>
      ) : (
        <>
          {/* ── Up next hero ── */}
          {nextExam ? (
            <div className="gradient-border relative overflow-hidden rounded-3xl bg-card p-6 shadow-lifted sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div className="flex min-w-0 items-start gap-4">
                  <div
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                      nextExam.attempt.status === "in_progress"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {nextExam.attempt.status === "in_progress" ? (
                      <FlameIcon className="size-6" />
                    ) : (
                      <BookOpenCheckIcon className="size-6" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                      Up next
                      {nextExam.attempt.status === "in_progress" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 normal-case dark:text-amber-300">
                          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                          In progress
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 normal-case dark:text-emerald-300">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          Ready
                        </span>
                      )}
                      {nextExam.attempt.retakeOf && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 normal-case dark:text-amber-300">
                          Retake
                        </span>
                      )}
                    </p>
                    <p className="mt-1 truncate text-xl font-bold tracking-tight sm:text-2xl">
                      {nextExam.exam?.title ?? "Exam"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                      {nextExam.exam && <span>{subjectOf(nextExam.exam.subject)}</span>}
                      <span className="tabular-nums">
                        {nextExam.exam?.questionCount ?? "–"} questions ·{" "}
                        {nextExam.exam?.durationMinutes ?? "–"} min
                      </span>
                      {dateOf(nextExam.attempt.scheduledFor, "EEE d MMM · HH:mm") && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarIcon className="size-3.5" />
                          {dateOf(nextExam.attempt.scheduledFor, "EEE d MMM · HH:mm")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  size="lg"
                  className="shrink-0 shadow-glow"
                  nativeButton={false}
                  render={<Link href={`/exam/${nextExam.attempt.id}`} />}
                >
                  {nextExam.attempt.status === "in_progress" ? "Continue exam" : "Start when ready"}
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-5 py-4">
              <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">All caught up</span>
                <span className="text-muted-foreground"> — no exams waiting right now.</span>
              </p>
              <Link
                href="/student/results"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Review results <ChevronRightIcon className="size-4" />
              </Link>
            </div>
          )}

          {/* ── Needs attention ── */}
          {(gradingNow.length > 0 ||
            underReview.length > 0 ||
            openRetakes.length > 0 ||
            pendingRequests.length > 0) && (
            <section aria-label="Needs your attention">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {gradingNow.length > 0 && (
                  <Link
                    href="/student/results"
                    className="group flex items-center gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-4 transition-colors hover:bg-sky-500/[0.1]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                      <ClockIcon className="size-4 animate-pulse" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums">
                        Grading · {gradingNow.length}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Results on the way
                      </span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
                {underReview.length > 0 && (
                  <Link
                    href="/student/results"
                    className="group flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4 transition-colors hover:bg-rose-500/[0.1]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400">
                      <ShieldAlertIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums">
                        Under review · {underReview.length}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Teacher is checking the session
                      </span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
                {openRetakes.length > 0 && (
                  <Link
                    href={`/exam/${openRetakes[0]!.attempt.id}`}
                    className="group flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 transition-colors hover:bg-emerald-500/[0.1]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <RotateCcwIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums">
                        Retake ready · {openRetakes.length}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Approved — complete it to score
                      </span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
                {pendingRequests.length > 0 && (
                  <Link
                    href={`/student/results/${pendingRequests[0]!.attemptId}`}
                    className="group flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 transition-colors hover:bg-amber-500/[0.1]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      <HistoryIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold tabular-nums">
                        Request pending · {pendingRequests.length}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Waiting on your teacher
                      </span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
              </div>
            </section>
          )}

          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiTile
              icon={TrophyIcon}
              label="Average score"
              value={average !== null ? `${average}%` : "—"}
              hint={data?.strongest ? `Strongest: ${data.strongest}` : taken > 0 ? "Keep pushing" : "No graded exams yet"}
              accent
            />
            <KpiTile
              icon={FileCheck2Icon}
              label="Exams taken"
              value={`${taken}`}
              hint={taken === 1 ? "First one done" : "Graded attempts"}
              iconClass="bg-primary/10 text-primary"
            />
            <KpiTile
              icon={ClipboardListIcon}
              label="To take"
              value={`${queue.length}`}
              hint={queue.length > 0 ? "Assigned, not yet taken" : "Nothing waiting"}
              iconClass="bg-amber-500/15 text-amber-600 dark:text-amber-400"
            />
            <KpiTile
              icon={TrophyIcon}
              label="Class rank"
              value={standing?.rank ? `#${standing.rank}` : "—"}
              hint={
                standing
                  ? standing.rank
                    ? `of ${standing.rankedTotal} ranked`
                    : "No graded exams yet"
                  : "Join a class to rank"
              }
              iconClass="bg-violet-500/15 text-violet-600 dark:text-violet-400"
            />
          </div>

          {/* ── Recent results + Up next ── */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>Recent results</CardTitle>
                    <CardDescription>Your latest graded exams.</CardDescription>
                  </div>
                  <Link
                    href="/student/results"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    View all <ChevronRightIcon className="size-3.5" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col">
                {recent.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    No graded exams yet — your scores will land here.
                  </p>
                ) : (
                  recent.map(({ attempt, exam }) => {
                    const pct = attempt.score!.percentage;
                    return (
                      <div
                        key={attempt.id}
                        className="group relative flex items-center gap-3 border-t px-1 py-3 first:border-t-0 first:pt-0 last:pb-0"
                      >
                        <Link
                          href={`/student/results/${attempt.id}`}
                          aria-label={`View results for ${exam?.title ?? "exam"}`}
                          className="absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        />
                        <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-muted-foreground">
                          <FileCheck2Icon className="size-4" />
                        </span>
                        <span className="pointer-events-none min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {exam?.title ?? "Exam"}
                            {attempt.status === "flagged" && (
                              <span className="ml-2 rounded-full bg-rose-500/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                Under review
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {exam ? `${subjectOf(exam.subject)} · ` : ""}
                            {dateOf(attempt.submittedAt) ?? "—"}
                          </span>
                        </span>
                        <span className="pointer-events-none flex w-24 shrink-0 flex-col gap-1.5 sm:w-28">
                          <span className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Score</span>
                            <span className={cn("font-bold tabular-nums", scoreTone(pct))}>
                              {pct}%
                            </span>
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <span
                              className={cn("block h-full rounded-full", scoreBar(pct))}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>Up next</CardTitle>
                    <CardDescription>Assigned exams waiting for you.</CardDescription>
                  </div>
                  <Link
                    href="/student/exams"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    View all <ChevronRightIcon className="size-3.5" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col">
                {queue.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    Nothing waiting — enjoy the breather.
                  </p>
                ) : (
                  queue.slice(0, 6).map(({ attempt, exam }) => {
                    const active = attempt.status === "in_progress";
                    const scheduled = dateOf(attempt.scheduledFor, "EEE d MMM, HH:mm");
                    return (
                      <div
                        key={attempt.id}
                        className="group relative flex items-center gap-3 border-t px-1 py-3 first:border-t-0 first:pt-0 last:pb-0"
                      >
                        <Link
                          href={`/exam/${attempt.id}`}
                          aria-label={`${active ? "Continue" : "Start"} ${exam?.title ?? "exam"}`}
                          className="absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        />
                        <span
                          className={cn(
                            "pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-xl",
                            active
                              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                          )}
                        >
                          {active ? (
                            <FlameIcon className="size-4" />
                          ) : (
                            <BookOpenCheckIcon className="size-4" />
                          )}
                        </span>
                        <span className="pointer-events-none min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate text-sm font-medium">
                              {exam?.title ?? "Exam"}
                            </span>
                            {attempt.retakeOf && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                              >
                                Retake
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                            {exam ? `${subjectOf(exam.subject)} · ` : ""}
                            {exam?.questionCount ?? "–"} questions · {exam?.durationMinutes ?? "–"}{" "}
                            min
                            {scheduled && <> · {scheduled}</>}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "pointer-events-none flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                            active
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-primary/10 text-primary",
                          )}
                        >
                          {active && (
                            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                          )}
                          {active ? "Continue" : "Start"}
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Charts (code-split island) ── */}
          {(trend.length > 0 || (data?.bySubject.length ?? 0) > 0) && (
            <DashboardCharts
              trend={trend}
              trendDescription={
                trend.length > 1 && trendDelta !== null
                  ? `Your last ${trend.length} graded exams · ${trendDelta >= 0 ? "+" : ""}${trendDelta} overall`
                  : "Your last 8 graded exams"
              }
              bySubject={data?.bySubject ?? []}
            />
          )}

          {/* ── Retake requests ── */}
          {requests.length > 0 && (
            <section aria-labelledby="requests-heading">
              <h2
                id="requests-heading"
                className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase"
              >
                Retake requests
              </h2>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
                <div className="divide-y">
                  {requests.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          r.status === "pending" &&
                            "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                          r.status === "approved" &&
                            "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                          r.status === "rejected" && "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                        )}
                      >
                        {r.status === "pending" && (
                          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                        )}
                        {r.status === "pending"
                          ? "Pending review"
                          : r.status === "approved"
                            ? "Approved"
                            : "Not approved"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/student/results/${r.attemptId}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {r.examTitle}
                        </Link>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          “{r.reason}” · {dateOf(r.decidedAt ?? r.createdAt) ?? "—"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Retakes per exam ── */}
          {(data?.retakesByExam.length ?? 0) > 0 && (
            <section aria-labelledby="retakes-heading">
              <h2
                id="retakes-heading"
                className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase"
              >
                Retakes per exam
              </h2>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
                <p className="border-b px-5 pt-4 pb-1 text-xs text-muted-foreground">
                  Approved retakes only — tap for history.
                </p>
                <div className="divide-y">
                  {data!.retakesByExam.map((r) => (
                    <div key={r.examId} className="group relative flex items-center gap-3 px-5 py-3.5">
                      <Link
                        href={`/student/exams/${r.examId}`}
                        aria-label={`History for ${r.title}`}
                        className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                      />
                      <span className="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-muted-foreground">
                        <RotateCcwIcon className="size-4" />
                      </span>
                      <span className="pointer-events-none min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                          {r.subject} · {r.count} retake{r.count !== 1 ? "s" : ""}
                        </span>
                      </span>
                      {r.improvement !== null && (
                        <span
                          className={cn(
                            "pointer-events-none shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            r.improvement > 0
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : r.improvement < 0
                                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {r.improvement > 0 ? "+" : ""}
                          {r.improvement}%
                        </span>
                      )}
                      <span className="pointer-events-none shrink-0 text-right">
                        <span className="block text-sm font-bold tabular-nums">{r.count}</span>
                        {r.latestScore !== null && (
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {r.latestScore}% latest
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── Study insight ── */}
          {data?.weakest && data.strongest && data.weakest !== data.strongest && (
            <div className="flex items-start gap-3.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4 shadow-card sm:p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <LightbulbIcon className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Study insight</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Strongest in <span className="font-medium text-foreground">{data.strongest}</span>{" "}
                  — focus revision on{" "}
                  <span className="font-medium text-foreground">{data.weakest}</span>, and ask your
                  teacher for practice exams on that subject.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
