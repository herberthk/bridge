export const dynamic = "force-dynamic";

import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  AwardIcon,
  BookOpenCheckIcon,
  CheckCircle2Icon,
  ClockIcon,
  LineChartIcon,
  ShieldAlertIcon,
  TargetIcon,
  TrophyIcon,
} from "lucide-react";

import { timestampToDate } from "@/lib/serialize";
import { requireRole } from "@/server/auth/session";
import { listStudentAttempts } from "@/server/services/attempts";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiTile } from "@/components/features/dashboard/kpi-tile";

export const metadata = { title: "Results • Bridge" };

// ─── Small pure helpers (server — zero client JS) ─────────────────────────────

function subjectOf(code: string): string {
  return SUBJECT_LABELS[code as Subject] ?? code;
}

function ringTone(pct: number): string {
  if (pct >= 80) return "text-emerald-500";
  if (pct >= 50) return "text-amber-500";
  return "text-rose-500";
}

function scoreTone(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

/** Pure-SVG score ring — no chart library, no client JS. */
function ScoreRing({ pct, size = 56 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${pct} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={5}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
          className={ringTone(pct)}
          stroke="currentColor"
        />
      </svg>
      <span className={cn("absolute text-[13px] font-bold tabular-nums", scoreTone(pct))}>
        {pct}
      </span>
    </span>
  );
}

/**
 * Results: fully server-rendered (zero client JS) — KPIs, per-subject
 * breakdown, and score-ring rows all paint with the HTML. The list query
 * already excludes answers/feedback, so this stays light at any scale.
 */
export default async function StudentResultsPage() {
  const actor = await requireRole("student");
  let items: Awaited<ReturnType<typeof listStudentAttempts>> = [];
  let loadFailed = false;
  try {
    items = await listStudentAttempts(actor);
  } catch (err) {
    console.error("[student/results] load failed", err);
    loadFailed = true;
  }

  const graded = items.filter(
    (i) => i.attempt.status === "graded" || i.attempt.status === "flagged",
  );
  const awaiting = items.filter((i) => i.attempt.status === "submitted");
  const scored = graded.filter((i) => i.attempt.score !== null);
  const pcts = scored.map((i) => i.attempt.score!.percentage);
  const avg =
    pcts.length > 0 ? Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length) : null;
  const best = pcts.length > 0 ? Math.max(...pcts) : null;
  const passRate =
    pcts.length > 0
      ? Math.round((pcts.filter((p) => p >= 50).length / pcts.length) * 100)
      : null;

  // Most recently graded vs the rest — a one-line trajectory signal.
  const byGradedAt = [...scored].sort(
    (a, b) =>
      (timestampToDate(b.attempt.gradedAt)?.getTime() ?? 0) -
      (timestampToDate(a.attempt.gradedAt)?.getTime() ?? 0),
  );
  const trendDelta =
    byGradedAt.length > 1
      ? byGradedAt[0]!.attempt.score!.percentage -
        Math.round(
          byGradedAt.slice(1).reduce((n, i) => n + i.attempt.score!.percentage, 0) /
            (byGradedAt.length - 1),
        )
      : null;

  // Per-subject averages for the breakdown strip.
  const bySubject = new Map<string, { total: number; count: number }>();
  for (const { attempt, exam } of scored) {
    if (!exam) continue;
    const entry = bySubject.get(exam.subject) ?? { total: 0, count: 0 };
    entry.total += attempt.score!.percentage;
    entry.count += 1;
    bySubject.set(exam.subject, entry);
  }
  const subjectRows = [...bySubject.entries()]
    .map(([code, { total, count }]) => ({
      code,
      label: subjectOf(code),
      avg: Math.round(total / count),
      count,
    }))
    .sort((a, b) => b.avg - a.avg);

  const bestId =
    best !== null
      ? scored.find((i) => i.attempt.score!.percentage === best)?.attempt.id
      : null;

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8">
      {/* Ambient page glow — pure CSS, zero JS, paints once behind the header. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-72">
        <div className="bg-mesh absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>

      {/* ── Header ── */}
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          Results
          {scored.length > 0 && avg !== null ? ` · ${scored.length} graded · ${avg}% avg` : ""}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              Results
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px]">
              {scored.length === 0
                ? "Your graded exams with scores and AI feedback will live here."
                : trendDelta !== null && trendDelta !== 0
                  ? `Latest result is ${trendDelta > 0 ? "+" : ""}${trendDelta} vs your earlier average — ${
                      trendDelta > 0 ? "keep climbing." : "review the feedback below."
                    }`
                  : "Your graded exams with scores and AI feedback."}
            </p>
          </div>
          <Button variant="outline" nativeButton={false} render={<Link href="/student/exams" />}>
            <BookOpenCheckIcon data-icon="inline-start" />
            My exams
          </Button>
        </div>
      </div>

      {loadFailed ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-destructive/30 bg-destructive/[0.06] px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-6" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Results couldn&apos;t load</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
              Check your connection and try again — if this keeps happening, contact your
              administrator.
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/student/results" />}>
            Retry
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      ) : graded.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-dashed bg-card/60 px-6 py-14 text-center sm:py-16">
          <span className="bg-brand flex size-14 items-center justify-center rounded-2xl text-white shadow-glow">
            <LineChartIcon className="size-7" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">No results yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-pretty text-muted-foreground">
              {awaiting.length > 0
                ? `${awaiting.length} exam${awaiting.length === 1 ? " is" : "s are"} being graded right now — scores land here the moment they're ready.`
                : "Take an exam and your graded results will appear here with per-question feedback."}
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/student/exams" />} className="shadow-glow">
            <BookOpenCheckIcon data-icon="inline-start" />
            View my exams
          </Button>
        </div>
      ) : (
        <>
          {/* ── Still-grading strip ── */}
          {awaiting.length > 0 && (
            <Link
              href="/student/exams"
              className="group flex items-center gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] px-5 py-4 transition-colors hover:bg-sky-500/[0.1]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400">
                <ClockIcon className="size-4 animate-pulse" />
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold tabular-nums">Grading · {awaiting.length}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {awaiting[0]!.exam?.title ?? "your exam"}
                  {awaiting.length > 1 ? ` and ${awaiting.length - 1} more` : ""} on the way
                </span>
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}

          {/* ── KPI tiles ── */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiTile
              icon={TrophyIcon}
              label="Average score"
              value={avg !== null ? `${avg}%` : "—"}
              hint={
                trendDelta !== null && trendDelta !== 0
                  ? `${trendDelta > 0 ? "+" : ""}${trendDelta} vs earlier avg`
                  : scored.length > 0
                    ? `Across ${scored.length} graded`
                    : "No graded exams yet"
              }
              accent
            />
            <KpiTile
              icon={AwardIcon}
              label="Best score"
              value={best !== null ? `${best}%` : "—"}
              hint={
                best !== null
                  ? scored.find((i) => i.attempt.score!.percentage === best)?.exam?.title ??
                    "Top result"
                  : "Aim high"
              }
              iconClass="bg-amber-500/15 text-amber-600 dark:text-amber-400"
            />
            <KpiTile
              icon={TargetIcon}
              label="Pass rate"
              value={passRate !== null ? `${passRate}%` : "—"}
              hint="Scored 50% or more"
              iconClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            />
            <KpiTile
              icon={CheckCircle2Icon}
              label="Graded exams"
              value={`${scored.length}`}
              hint={
                graded.length > scored.length
                  ? `${graded.length - scored.length} awaiting score`
                  : "Full feedback each"
              }
              iconClass="bg-primary/10 text-primary"
            />
          </div>

          {/* ── Per-subject breakdown ── */}
          {subjectRows.length > 1 && (
            <section aria-label="Performance by subject">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {subjectRows.slice(0, 4).map((s) => (
                  <div key={s.code} className="rounded-2xl border bg-card p-4 shadow-card">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{s.label}</p>
                      <span className={cn("text-sm font-bold tabular-nums", scoreTone(s.avg))}>
                        {s.avg}%
                      </span>
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          s.avg >= 80
                            ? "bg-emerald-500"
                            : s.avg >= 50
                              ? "bg-amber-500"
                              : "bg-rose-500",
                        )}
                        style={{ width: `${s.avg}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                      {s.count} graded exam{s.count !== 1 ? "s" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Results list ── */}
          <div className="overflow-hidden rounded-3xl border bg-card shadow-card">
            <div className="divide-y">
              {graded.map(({ attempt, exam }) => {
                const gradedWhen = timestampToDate(attempt.gradedAt);
                const pct = attempt.score?.percentage;
                const isBest = bestId !== null && attempt.id === bestId;
                return (
                  <Link
                    key={attempt.id}
                    href={`/student/results/${attempt.id}`}
                    className="group relative flex items-center gap-4 px-4 py-4 transition-colors hover:bg-accent/40 sm:px-5"
                    aria-label={`View results for ${exam?.title ?? "exam"}`}
                  >
                    {pct != null ? (
                      <ScoreRing pct={pct} />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                        {attempt.status === "flagged" ? (
                          <ShieldAlertIcon className="size-5" />
                        ) : (
                          <ClockIcon className="size-5 animate-pulse" />
                        )}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[15px] font-semibold">
                          {exam?.title ?? "Exam"}
                        </span>
                        {isBest && (
                          <Badge className="bg-amber-500/15 px-1.5 py-0 text-[10px] font-bold text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
                            Best
                          </Badge>
                        )}
                        {attempt.status === "flagged" && (
                          <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                            Under review
                          </Badge>
                        )}
                        {attempt.retakeOf && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
                          >
                            Retake
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {exam ? `${subjectOf(exam.subject)} · ` : ""}
                        {exam ? `${exam.questionCount} questions · ${exam.durationMinutes} min · ` : ""}
                        {attempt.score
                          ? `${attempt.score.earned}/${attempt.score.possible} marks · `
                          : ""}
                        {gradedWhen
                          ? format(gradedWhen, "d MMM yyyy, HH:mm")
                          : attempt.status === "flagged"
                            ? "Under review"
                            : "Grading…"}
                      </span>
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
