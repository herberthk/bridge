"use client";

import { memo, useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  CalculatorIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FileDownIcon,
  LightbulbIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TargetIcon,
  TimerIcon,
  TrendingUpIcon,
  XCircleIcon,
  type LucideIcon,
} from "lucide-react";

import { requestRetakeAction } from "@/app/student/actions";
import { Markdown } from "@/components/markdown";
import { useActionToast } from "@/components/features/super/schools-manager";
import { answerMarkdown, correctMarkdown } from "@/lib/exam/answers";
import { bucketFor, summarizeMarks, weightShare, type MarkEntry, type MarksBreakdown, type ReviewBucket, type ReviewFilter } from "@/lib/exam/review-buckets";
import { summarizeQuestion } from "@/lib/exam/latex";
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS, type Subject } from "@/lib/constants";
import type { AttemptAnswer, AttemptDoc, AttemptScore, ExamDoc, Question } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { parseDate } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Heavy visual (recharts) loads only when a visible question has one ──────
// Question review mounts up to 10 questions per page; pulling recharts into the
// main bundle would tax every results visit, including text-only exams. The
// dynamic chunk below is fetched only when `hasVisualOnPage` is true.

const QuestionVisualView = dynamic(
  () =>
    import("@/components/features/exam/question-visual").then((m) => ({
      default: m.QuestionVisualView,
    })),
  {
    ssr: false,
    loading: () => <Skeleton className="h-48 w-full rounded-2xl" />,
  },
);

// ─── Grade system (single source — was three parallel if-chains) ──────────────

function gradeMeta(pct: number): {
  label: string;
  /** Ring stroke on the dark brand hero. */
  stroke: string;
  /** Verdict text on card surfaces (both modes). */
  verdict: string;
} {
  if (pct >= 80)
    return {
      label: "Excellent",
      stroke: "#34d399",
      verdict: "text-emerald-600 dark:text-emerald-400",
    };
  if (pct >= 65)
    return {
      label: "Good",
      stroke: "#a3e635",
      verdict: "text-lime-600 dark:text-lime-400",
    };
  if (pct >= 50)
    return {
      label: "Fair",
      stroke: "#fbbf24",
      verdict: "text-amber-600 dark:text-amber-400",
    };
  return {
    label: "Needs work",
    stroke: "#fb7185",
    verdict: "text-destructive",
  };
}

function formatDuration(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds === null || totalSeconds === undefined) return null;
  if (totalSeconds < 60) return `${Math.max(1, Math.round(totalSeconds))} sec`;
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Average marks per question, trimmed ("3" not "3.0"). */
function avgMarks(possible: number, count: number): string {
  if (count === 0) return "—";
  const avg = possible / count;
  return Number.isInteger(avg) ? `${avg}` : avg.toFixed(1);
}

/** Share percent, trimmed ("8" not "8.0"). */
function formatShare(share: number): string {
  return share % 1 === 0 ? `${share}` : share.toFixed(1);
}

// ─── AnswerText ───────────────────────────────────────────────────────────────

const AnswerText = memo(function AnswerText({
  text,
  emptyPlaceholder = "not answered",
}: {
  text: string | null;
  emptyPlaceholder?: string;
}) {
  if (!text) {
    return (
      <span className="font-normal text-muted-foreground italic">{emptyPlaceholder}</span>
    );
  }
  return <Markdown className="prose-bridge">{text}</Markdown>;
});

// ─── Score ring + bar (CSS transitions — no animation library) ────────────────

const ScoreRing = memo(function ScoreRing({
  pct,
  stroke,
}: {
  pct: number;
  stroke: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const R = 54;
  const C = 2 * Math.PI * R;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      role="img"
      aria-label={`Score ${Math.round(pct)} percent`}
      className="relative size-36 shrink-0 sm:size-40"
    >
      <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="11"
        />
        <circle
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={mounted ? C * (1 - clamped / 100) : C}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums sm:text-[2.75rem]">
          {Math.round(pct)}
          <span className="text-xl font-semibold opacity-70">%</span>
        </span>
      </div>
    </div>
  );
});

// ─── Marks composition bar — where the percentage comes from ─────────────────
// One segmented strip instead of a single fill: earned-from-correct, partial
// credit, marks lost on failed questions, marks left blank. Fixed semantic
// colors read on the brand hero in both modes; the visible legend carries the
// numbers so the graphic needs no interpretation.

const CompositionBar = memo(function CompositionBar({
  breakdown,
}: {
  breakdown: MarksBreakdown;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const correctEarned = breakdown.correct.earned;
  const partialEarned = breakdown.failed.earned;
  const failedLost = Math.max(0, breakdown.failed.possible - breakdown.failed.earned);
  const skippedLost = Math.max(0, breakdown.skipped.possible - breakdown.skipped.earned);
  const total = correctEarned + partialEarned + failedLost + skippedLost;
  const segments = useMemo(
    () =>
      [
        { value: correctEarned, bar: "bg-emerald-400", label: "Correct", marks: correctEarned },
        { value: partialEarned, bar: "bg-lime-300", label: "Partial credit", marks: partialEarned },
        { value: failedLost, bar: "bg-rose-400", label: "Lost · failed", marks: failedLost },
        { value: skippedLost, bar: "bg-amber-300", label: "Left blank", marks: skippedLost },
      ].filter((s) => s.value > 0),
    [correctEarned, partialEarned, failedLost, skippedLost],
  );
  if (total <= 0 || segments.length === 0) return null;
  return (
    <div>
      <div
        role="img"
        aria-label={`Marks breakdown out of ${total}: ${segments
          .map((s) => `${s.marks} ${s.label.toLowerCase()}`)
          .join(", ")}`}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/20"
      >
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.marks} marks`}
            className={cn("h-full transition-[width] duration-700 ease-out", s.bar)}
            style={{ width: mounted ? `${(s.value / total) * 100}%` : "0%" }}
          />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs opacity-85">
            <span aria-hidden className={cn("size-2 rounded-full", s.bar)} />
            <span>{s.label}</span>
            <span className="font-bold tabular-nums">{s.marks}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

// ─── Hero stat tile (translucent on brand) ────────────────────────────────────

const StatTile = memo(function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/10 p-3.5 ring-1 ring-white/15 backdrop-blur-sm sm:p-4">
      <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 text-white">
        <Icon className="size-4" />
      </div>
      <p className="mt-2.5 truncate text-lg font-bold tabular-nums sm:text-xl">{value}</p>
      <p className="text-[11px] font-semibold tracking-wider uppercase opacity-70">{label}</p>
      {sub ? <p className="mt-0.5 truncate text-xs opacity-70">{sub}</p> : null}
    </div>
  );
});

// ─── Pagination ───────────────────────────────────────────────────────────────

const QN_PAGE_SIZE = 10;

const Pagination = memo(function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const pages = useMemo<(number | "…")[]>(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out: (number | "…")[] = [1];
    if (page > 3) out.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      out.push(i);
    }
    if (page < totalPages - 2) out.push("…");
    out.push(totalPages);
    return out;
  }, [page, totalPages]);

  const go = useMemo(() => onPage, [onPage]);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t px-2 py-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(page - 1)}
          disabled={page === 1}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-8 items-center justify-center text-xs text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => go(p)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm font-medium transition-colors tabular-nums",
                p === page ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent",
              )}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => go(page + 1)}
          disabled={page === totalPages}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
});

// ─── Retake dialog ────────────────────────────────────────────────────────────

const RETAKE_CHIPS = [
  "Internet dropped mid-exam",
  "Power outage",
  "Health issue",
  "Proctoring flagged incorrectly",
] as const;

function RetakeDialog({
  attemptId,
  flagged,
  disabled,
  pendingLabel,
  hasOpenRetake,
}: {
  attemptId: string;
  flagged?: boolean;
  disabled?: boolean;
  pendingLabel?: boolean;
  hasOpenRetake?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, formAction, pending] = useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(requestRetakeAction, null);
  const closeDialog = useCallback(() => setOpen(false), []);
  useActionToast(state, closeDialog, "Retake requested — your teacher will review it.");

  if (disabled) {
    if (hasOpenRetake) {
      return (
        <Button variant="outline" disabled className="min-w-37 opacity-80">
          <CheckCircle2Icon data-icon="inline-start" className="size-4 text-emerald-600" />
          Approved — complete retake
        </Button>
      );
    }
    return (
      <Button variant="outline" disabled className="min-w-37 opacity-80">
        <ClockIcon data-icon="inline-start" className="size-4" />
        {pendingLabel ? "Pending" : "Request sent"}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={flagged ? "default" : "outline"}
            className={flagged ? "shadow-glow" : ""}
          />
        }
      >
        <RotateCcwIcon data-icon="inline-start" />
        {flagged ? "Request retake — flagged" : "Request retake"}
      </DialogTrigger>
      <DialogContent className="overflow-hidden rounded-2xl border p-0 shadow-lifted sm:max-w-[520px]">
        <div className="bg-brand relative overflow-hidden p-6 text-primary-foreground">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                "radial-gradient(18rem 10rem at 15% 0%, white, transparent 60%)",
            }}
          />
          <p className="relative inline-flex items-center gap-2 text-xs font-medium opacity-80">
            <ShieldAlertIcon className="size-3.5" /> Retake request
          </p>
          <DialogTitle className="relative mt-1 text-lg font-semibold text-white">
            Request a retake
          </DialogTitle>
          <DialogDescription className="relative mt-1 text-sm text-white/80">
            {flagged
              ? "Your attempt was flagged for review — explain what happened and your teacher will decide."
              : "Your teacher reviews every request. Pick a chip or write your reason (10–500 chars)."}
          </DialogDescription>
        </div>

        <form action={formAction} className="flex flex-col gap-4 p-6">
          <input type="hidden" name="attemptId" value={attemptId} />
          <Field>
            <FieldLabel htmlFor="reason" className="flex items-center justify-between">
              Reason{" "}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  reason.length < 10
                    ? "text-amber-600"
                    : reason.length > 500
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {reason.length}/500
              </span>
            </FieldLabel>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {RETAKE_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setReason(c)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    reason === c
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : "bg-muted hover:bg-accent",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <Textarea
              id="reason"
              name="reason"
              rows={4}
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                flagged
                  ? "e.g. My camera froze at question 8 — I stayed in the room and did not cheat…"
                  : "e.g. I lost internet during question 12 and couldn't finish…"
              }
              className="min-h-[96px] rounded-xl border bg-card shadow-card"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Be specific — teachers approve well-explained requests faster.
            </p>
            {state?.error && (
              <p className="animate-in fade-in-0 slide-in-from-top-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive duration-200">
                <AlertTriangleIcon className="mr-1 inline size-3" /> {state.error}
              </p>
            )}
          </Field>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || reason.trim().length < 10}
              className="min-w-[132px] rounded-xl shadow-glow"
            >
              {pending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />{" "}
                  Sending…
                </>
              ) : (
                <>
                  <RotateCcwIcon data-icon="inline-start" /> Send request
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Review grouping (one O(n) pass over a Map — was find-in-loop) ────────────
// Buckets live in `@/lib/exam/review-buckets` (pure + unit-tested).

interface ReviewEntry {
  q: Question;
  ans: AttemptAnswer | undefined;
  bucket: ReviewBucket;
  /** Position in the exam — the stable Q number under any sort. */
  index: number;
}

/** Review sort: what needs attention first. Correct answers sink to the end. */
const BUCKET_RANK: Record<ReviewBucket, number> = { failed: 0, skipped: 1, correct: 2 };

// ─── Detailed assessment ──────────────────────────────────────────────────────

const ScoreComposition = memo(function ScoreComposition({
  score,
  marks,
}: {
  score: AttemptScore;
  marks: MarksBreakdown;
}) {
  const shareOf = (possible: number) => Math.round((possible / score.possible) * 100);
  const missedShare = shareOf(marks.failed.possible + marks.skipped.possible);
  const failedLost = Math.max(0, marks.failed.possible - marks.failed.earned);
  return (
    <div className="rounded-2xl border p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CalculatorIcon className="size-4 text-primary" /> Where your {score.percentage}% comes
        from
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Questions carry different marks — this is the score in marks, not in question counts.
      </p>
      <div className="mt-3 grid gap-2">
        {marks.correct.count > 0 && (
          <BreakdownRow
            icon={CheckCircle2Icon}
            iconClass="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            label="Correct"
            detail={`${marks.correct.count} questions · avg ${avgMarks(marks.correct.possible, marks.correct.count)} marks each`}
            marks={`${marks.correct.earned}/${marks.correct.possible}`}
            share={`${shareOf(marks.correct.possible)}% of paper`}
          />
        )}
        {marks.failed.count > 0 && (
          <BreakdownRow
            icon={XCircleIcon}
            iconClass="bg-destructive/10 text-destructive"
            label="Failed"
            detail={`${marks.failed.count} questions · avg ${avgMarks(marks.failed.possible, marks.failed.count)} each · −${failedLost} lost`}
            marks={`${marks.failed.earned}/${marks.failed.possible}`}
            share={`${shareOf(marks.failed.possible)}% of paper`}
          />
        )}
        {marks.skipped.count > 0 && (
          <BreakdownRow
            icon={AlertTriangleIcon}
            iconClass="bg-amber-500/15 text-amber-600 dark:text-amber-400"
            label="Skipped"
            detail={`${marks.skipped.count} questions · avg ${avgMarks(marks.skipped.possible, marks.skipped.count)} each · all left blank`}
            marks={`${marks.skipped.earned}/${marks.skipped.possible}`}
            share={`${shareOf(marks.skipped.possible)}% of paper`}
          />
        )}
      </div>
      {missedShare > 50 && (
        <p className="mt-3 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Missed or skipped questions held{" "}
          <span className="font-bold text-foreground tabular-nums">{missedShare}%</span> of this
          paper&apos;s marks — weight, more than count, is what set this score.
        </p>
      )}
    </div>
  );
});

const BreakdownRow = memo(function BreakdownRow({  icon: Icon,
  iconClass,
  label,
  detail,
  marks,
  share,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  detail: string;
  marks: string;
  share: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClass)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-bold tabular-nums">{marks}</span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">{share}</span>
      </span>
    </div>
  );
});

const DetailedAssessment = memo(function DetailedAssessment({
  attempt,
  exam,
  answerMap,
  onSelectFilter,
  onJumpToQuestion,
}: {
  attempt: SerializedWithId<AttemptDoc>;
  exam: SerializedWithId<ExamDoc>;
  answerMap: Map<string, AttemptAnswer>;
  /** Filter the review below and scroll to it (KPI tiles, "view all" links). */
  onSelectFilter: (f: ReviewFilter) => void;
  /** Open one question in the review, wherever it sits. */
  onJumpToQuestion: (questionId: string, bucket: ReviewBucket) => void;
}) {
  const { correct, failed, skipped, suggestions, missing, priority, marks } = useMemo(() => {
    const correct: ReviewEntry[] = [];
    const failed: ReviewEntry[] = [];
    const skipped: ReviewEntry[] = [];
    const markEntries: MarkEntry[] = [];
    for (let i = 0; i < exam.questions.length; i += 1) {
      const q = exam.questions[i]!;
      const ans = answerMap.get(q.id);
      const entry: ReviewEntry = { q, ans, bucket: bucketFor(ans), index: i };
      if (entry.bucket === "correct") correct.push(entry);
      else if (entry.bucket === "failed") failed.push(entry);
      else skipped.push(entry);
      markEntries.push({
        points: q.points,
        earned: ans?.graded?.earned ?? 0,
        bucket: entry.bucket,
      });
    }
    const earned = attempt.score?.earned ?? 0;
    const possible = attempt.score?.possible ?? exam.questions.length;
    const missing = Math.max(0, possible - earned);
    const feedback = attempt.feedback;

    const suggestions: string[] = [];
    if (failed.length > 0)
      suggestions.push(
        `Revise ${failed.length} failed question${failed.length > 1 ? "s" : ""}: focus on understanding the correct approach, not just the answer.`,
      );
    if (skipped.length > 0)
      suggestions.push(
        `Attempt ${skipped.length} skipped question${skipped.length > 1 ? "s" : ""} next time — even educated guesses earn marks.`,
      );
    if (feedback?.improvements?.length) suggestions.push(...feedback.improvements.slice(0, 2));
    const typeCounts = new Map<string, number>();
    for (const { q } of failed) typeCounts.set(q.type, (typeCounts.get(q.type) ?? 0) + 1);
    const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topType)
      suggestions.push(
        `Practice more "${topType[0].replace(/_/g, " ")}" questions — you missed ${topType[1]} of that type.`,
      );
    // The roadmap stays compact on purpose: per-question detail (answers,
    // tips, worked examples) lives once in the question review below, and
    // every row here deep-links to it.
    const lossOf = (e: ReviewEntry) => e.q.points - (e.ans?.graded?.earned ?? 0);
    const priority = [...failed, ...skipped]
      .sort((a, b) => lossOf(b) - lossOf(a) || a.index - b.index)
      .slice(0, 3);
    return { correct, failed, skipped, suggestions, missing, priority, marks: summarizeMarks(markEntries) };
  }, [answerMap, attempt.feedback, attempt.score, exam.questions]);

  const total = exam.questions.length;
  const feedback = attempt.feedback;

  const perfect =
    total > 0 &&
    correct.length === total &&
    marks.correct.earned === marks.correct.possible;
  if (perfect) {
    return (
      <Card className="border-emerald-500/25 bg-emerald-500/[0.06] shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15">
              <CheckCircle2Icon className="size-5" />
            </span>
            Perfect — 100% achieved
          </CardTitle>
          <CardDescription>
            You answered every question correctly. Keep this momentum for the next exam!
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/25 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <BookOpenIcon className="size-5" />
          </span>
          Detailed assessment — roadmap to 100%
        </CardTitle>
        <CardDescription className="tabular-nums">
          {failed.length} failed · {skipped.length} skipped · {correct.length} correct of{" "}
          {total} — you&apos;re{" "}
          <span className="font-semibold text-foreground">
            {missing} mark{missing !== 1 ? "s" : ""}
          </span>{" "}
          from 100%.{" "}
          {attempt.retakeOf
            ? "This is a retake — compare with your previous attempt above."
            : "Review below to close the gap."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* KPI row — each tile filters the review below and scrolls to it */}
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => onSelectFilter("correct")}
            title="Show correct questions in the review"
            className="group/kpi rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-center transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-2xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
              {correct.length}
            </p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              Correct{" "}
              <span aria-hidden className="opacity-0 transition-opacity group-hover/kpi:opacity-100">
                →
              </span>
            </p>
          </button>
          <button
            type="button"
            onClick={() => onSelectFilter("failed")}
            title="Show failed questions in the review"
            className="group/kpi rounded-2xl border border-destructive/20 bg-destructive/[0.05] p-4 text-center transition-colors hover:border-destructive/40 hover:bg-destructive/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-2xl font-bold text-destructive tabular-nums">{failed.length}</p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              Failed{" "}
              <span aria-hidden className="opacity-0 transition-opacity group-hover/kpi:opacity-100">
                →
              </span>
            </p>
          </button>
          <button
            type="button"
            onClick={() => onSelectFilter("skipped")}
            title="Show skipped questions in the review"
            className="group/kpi rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-center transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-2xl font-bold text-amber-700 tabular-nums dark:text-amber-400">
              {skipped.length}
            </p>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              Skipped{" "}
              <span aria-hidden className="opacity-0 transition-opacity group-hover/kpi:opacity-100">
                →
              </span>
            </p>
          </button>
        </div>

        {/* Suggestions */}
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <LightbulbIcon className="size-4 text-amber-600 dark:text-amber-400" /> How to reach
            100%
          </p>
          <ol className="mt-3 flex flex-col gap-2.5">
            {suggestions.slice(0, 5).map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-bold text-emerald-700 tabular-nums dark:text-emerald-300"
                >
                  {i + 1}
                </span>
                <AnswerText text={s} />
              </li>
            ))}
          </ol>
          {feedback?.perQuestion && (
            <p className="mt-3 text-xs text-muted-foreground">
              Per-question AI feedback is also shown in the review below.
            </p>
          )}
        </div>

        {/* Score composition — why counts don't explain the percentage */}
        {attempt.score && attempt.score.possible > 0 && (
          <ScoreComposition score={attempt.score} marks={marks} />
        )}

        {/* Priority fixes — biggest marks-loss first, each opening its review card */}
        {priority.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <TargetIcon className="size-4 text-destructive" /> Priority fixes — biggest marks
              first
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {priority.map((entry) => {
                const loss = entry.q.points - (entry.ans?.graded?.earned ?? 0);
                const isFailed = entry.bucket === "failed";
                return (
                  <button
                    key={entry.q.id}
                    type="button"
                    onClick={() => onJumpToQuestion(entry.q.id, entry.bucket)}
                    title="Open this question in the review"
                    className="group/fix flex items-center gap-3 rounded-2xl border bg-card p-3.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
                  >
                    <span aria-hidden className="shrink-0">
                      {isFailed ? (
                        <span className="flex size-6 items-center justify-center rounded-full bg-destructive/10">
                          <XCircleIcon className="size-3.5 text-destructive" />
                        </span>
                      ) : (
                        <span className="flex size-6 items-center justify-center rounded-full bg-amber-500/15">
                          <AlertTriangleIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium tabular-nums">
                        Q{entry.index + 1}. {summarizeQuestion(entry.q.prompt, 90)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {isFailed ? "Wrong answer" : "Left blank"} — open fix in review
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive tabular-nums">
                      −{loss}
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/fix:translate-x-0.5" />
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium">
              {failed.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectFilter("failed")}
                  className="text-destructive hover:underline"
                >
                  View all {failed.length} failed →
                </button>
              )}
              {skipped.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectFilter("skipped")}
                  className="text-amber-700 hover:underline dark:text-amber-400"
                >
                  View all {skipped.length} skipped →
                </button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// ─── Question card (memoized — only the visible page renders) ─────────────────

/** Card icon follows bucket semantics; see the note at the call site. */
function cardStatus(
  bucket: ReviewBucket,
  correct: boolean | null | undefined,
): ReviewBucket | "pending" {
  if (bucket === "skipped") return "skipped";
  if (correct === true) return "correct";
  if (correct === false) return "failed";
  return "pending";
}

const QuestionCard = memo(function QuestionCard({
  q,
  index,
  answer,
  perQFeedback,
  bucket,
  weightPct,
}: {
  q: Question;
  index: number;
  answer: AttemptAnswer | undefined;
  perQFeedback: string | null;
  bucket: ReviewBucket;
  /** The question's share of the paper's marks — null when unweighable. */
  weightPct: number | null;
}) {
  const graded = answer?.graded;
  // The icon follows the review bucket, not the raw verdict: a blank essay
  // stores `graded: null`, which must read "skipped" (amber) rather than
  // borrowing the grading-pending clock. `correct: null` on an *answered*
  // question stays pending.
  const status: ReviewBucket | "pending" = cardStatus(bucket, graded?.correct);

  // One tip, shown once: personal AI feedback wins, the model explanation is
  // the fallback. Failed cards lead with it ("What to fix"); everyone else
  // keeps the explanation → worked example → feedback reading order.
  const aiText = perQFeedback ?? graded?.feedback ?? null;
  const fixTip = bucket === "failed" ? (aiText ?? q.explanation) : null;
  const explanationText =
    q.explanation !== null && q.explanation !== fixTip ? q.explanation : null;
  const aiPanelText = aiText !== null && aiText !== fixTip ? aiText : null;

  return (
    <details
      id={`question-${q.id}`}
      className="group scroll-mt-24 rounded-2xl border bg-card transition-colors open:shadow-card [content-visibility:auto] [contain-intrinsic-size:auto_220px]"
      name="question-review"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-4 transition-colors marker:hidden hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <div className="shrink-0" aria-hidden>
          {status === "correct" ? (
            <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : status === "failed" ? (
            <div className="flex size-6 items-center justify-center rounded-full bg-destructive/10">
              <XCircleIcon className="size-3.5 text-destructive" />
            </div>
          ) : status === "skipped" ? (
            <div className="flex size-6 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangleIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
            </div>
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-muted">
              <ClockIcon className="size-3.5 text-muted-foreground" />
            </div>
          )}
        </div>

        <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
          Q{index + 1}. {summarizeQuestion(q.prompt, 80)}
        </span>

        <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
          {QUESTION_TYPE_LABELS[q.type]}
        </span>

        {graded && (
          <Badge
            variant={graded.correct === true ? "secondary" : "outline"}
            title={
              weightPct !== null
                ? `Earned ${graded.earned} of ${graded.possible} marks · worth ${formatShare(weightPct)}% of the paper`
                : undefined
            }
            className={cn(
              "shrink-0 text-xs tabular-nums",
              graded.correct === true
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : graded.correct === false
                  ? "border-destructive/20 text-destructive"
                  : "text-muted-foreground",
            )}
          >
            {graded.earned}/{graded.possible}
          </Badge>
        )}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90" />
      </summary>

      <div className="flex flex-col gap-4 border-t p-4">
        <div className="text-sm">
          <Markdown>{q.prompt}</Markdown>
        </div>
        {weightPct !== null && (
          <p className="-mt-2 text-xs text-muted-foreground tabular-nums">
            Worth {q.points} mark{q.points !== 1 ? "s" : ""} · {formatShare(weightPct)}% of
            this paper
          </p>
        )}
        {q.visual ? <QuestionVisualView visual={q.visual} /> : null}
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-muted p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Your answer</p>
            <div className="font-medium">
              <AnswerText text={answerMarkdown(answer?.response, q)} />
            </div>
          </div>
          <div className="rounded-xl bg-emerald-500/10 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Correct answer</p>
            <div className="font-medium">
              <AnswerText text={correctMarkdown(q)} emptyPlaceholder="no model answer" />
            </div>
          </div>
        </div>
        {fixTip && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/[0.05] p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <TargetIcon className="size-3.5" /> What to fix
            </p>
            <Markdown>{fixTip}</Markdown>
          </div>
        )}
        {explanationText && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Explanation</p>
            <Markdown>{explanationText}</Markdown>
          </div>
        )}
        {q.workedExample && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Worked example</p>
            <Markdown>{q.workedExample}</Markdown>
          </div>
        )}
        {aiPanelText && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-3 text-sm">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SparklesIcon className="size-3.5 text-violet-500" /> AI feedback
            </p>
            <Markdown>{aiPanelText}</Markdown>
          </div>
        )}
      </div>
    </details>
  );
});

// ─── Main ResultsView ─────────────────────────────────────────────────────────

const FILTER_TABS: { id: ReviewFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "correct", label: "Correct" },
  { id: "failed", label: "Failed" },
  { id: "skipped", label: "Skipped" },
];

export function ResultsView({
  attempt,
  exam,
  hasPendingRequest = false,
  hasOpenRetake = false,
}: {
  attempt: SerializedWithId<AttemptDoc>;
  exam: SerializedWithId<ExamDoc> | null;
  hasPendingRequest?: boolean;
  hasOpenRetake?: boolean;
}) {
  const router = useRouter();
  const [qPage, setQPage] = useState(1);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [sortMode, setSortMode] = useState<"order" | "priority">("order");
  /**
   * Pending deep-jump target, consumed by the effect below after React
   * commits the new filter/page — a double-rAF here can fire before the
   * commit lands on slow devices and miss the card entirely. A ref + nonce
   * (not state) so consuming it never triggers a cascading render, including
   * when the target is already on the current page.
   */
  const jumpTargetRef = useRef<string | null>(null);
  const [jumpNonce, setJumpNonce] = useState(0);

  const score = attempt.score;
  const feedback = attempt.feedback;
  const hasScore = score !== null && score !== undefined;
  const flagged = attempt.status === "flagged";
  const graded = attempt.status === "graded" || flagged;
  // Display must never contradict the data: pre-fix docs can carry status
  // "submitted" with a finalized score (run the backfill to heal the status).
  // The banner is reserved for attempts genuinely awaiting grades.
  const pending = attempt.status === "submitted" && !hasScore;
  const isFinal = graded || hasScore;

  const questions = useMemo(() => exam?.questions ?? [], [exam]);

  // Paper total from the questions themselves — always available when the
  // review renders, unlike score which needs finalization.
  const paperTotal = useMemo(
    () => questions.reduce((n, q) => n + q.points, 0),
    [questions],
  );

  // O(1) answer lookup shared by the assessment, filters and cards.
  const answerMap = useMemo(
    () => new Map<string, AttemptAnswer>(attempt.answers.map((a) => [a.questionId, a])),
    [attempt.answers],
  );

  const counts = useMemo(() => {
    const c: Record<ReviewBucket, number> = { correct: 0, failed: 0, skipped: 0 };
    for (const q of questions) c[bucketFor(answerMap.get(q.id))] += 1;
    return c;
  }, [answerMap, questions]);

  // Marks composition for the hero bar — counts never set the score, weights do.
  const marksBreakdown = useMemo(
    () =>
      summarizeMarks(
        questions.map((q) => ({
          points: q.points,
          earned: answerMap.get(q.id)?.graded?.earned ?? 0,
          bucket: bucketFor(answerMap.get(q.id)),
        })),
      ),
    [answerMap, questions],
  );

  const filteredQuestions = useMemo(
    () =>
      filter === "all"
        ? questions
        : questions.filter((q) => bucketFor(answerMap.get(q.id)) === filter),
    [answerMap, filter, questions],
  );

  // Stable exam position per question — Q numbers stay put under any sort.
  const questionIndex = useMemo(
    () => new Map(questions.map((q, i) => [q.id, i] as const)),
    [questions],
  );

  const orderedQuestions = useMemo(() => {
    if (sortMode === "order") return filteredQuestions;
    return [...filteredQuestions].sort((a, b) => {
      const rank =
        BUCKET_RANK[bucketFor(answerMap.get(a.id))] -
        BUCKET_RANK[bucketFor(answerMap.get(b.id))];
      if (rank !== 0) return rank;
      return (questionIndex.get(a.id) ?? 0) - (questionIndex.get(b.id) ?? 0);
    });
  }, [answerMap, filteredQuestions, questionIndex, sortMode]);

  const totalQPages = Math.max(1, Math.ceil(orderedQuestions.length / QN_PAGE_SIZE));
  const safePage = Math.min(qPage, totalQPages);
  const pagedQuestions = useMemo(
    () => orderedQuestions.slice((safePage - 1) * QN_PAGE_SIZE, safePage * QN_PAGE_SIZE),
    [orderedQuestions, safePage],
  );
  const pageOffset = (safePage - 1) * QN_PAGE_SIZE;

  const submittedLabel = useMemo(() => {
    const d = parseDate(attempt.submittedAt);
    return d ? format(d, "d MMM yyyy · HH:mm") : attempt.autoSubmitted ? "Auto-submitted" : null;
  }, [attempt.autoSubmitted, attempt.submittedAt]);

  const timeLabel = useMemo(
    () => formatDuration(attempt.timeSpentSeconds),
    [attempt.timeSpentSeconds],
  );

  const paceLabel = useMemo(() => {
    if (!attempt.timeSpentSeconds || questions.length === 0) return null;
    const avg = attempt.timeSpentSeconds / questions.length;
    return avg < 60 ? `${Math.round(avg)}s / question` : `${(avg / 60).toFixed(1)} min / question`;
  }, [attempt.timeSpentSeconds, questions.length]);

  const subjectLabel = exam ? (SUBJECT_LABELS[exam.params.subject as Subject] ?? null) : null;

  const meta = score ? gradeMeta(score.percentage) : null;
  const missing = score ? Math.max(0, score.possible - score.earned) : 0;
  const cleanSession = attempt.violationsCount === 0;

  const handleBack = useCallback(() => router.back(), [router]);

  const handleQPage = useCallback((p: number) => {
    setQPage(p);
    document
      .getElementById("question-review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleFilter = useCallback((f: ReviewFilter) => {
    setFilter(f);
    setQPage(1);
  }, []);

  const handleSortToggle = useCallback(() => {
    setSortMode((m) => (m === "priority" ? "order" : "priority"));
    setQPage(1);
  }, []);

  /** Assessment entry point: filter the review and bring it into view. */
  const handleAssessmentFilter = useCallback((f: ReviewFilter) => {
    setFilter(f);
    setQPage(1);
    document
      .getElementById("question-review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /**
   * Open one question wherever it sits: narrow to its bucket and land on its
   * page (in exam order, so the landing is predictable). The effect below
   * expands the card and scrolls once the new page has committed.
   */
  const handleJumpToQuestion = useCallback(
    (questionId: string, bucket: ReviewBucket) => {
      const list = questions.filter((q) => bucketFor(answerMap.get(q.id)) === bucket);
      const at = list.findIndex((q) => q.id === questionId);
      setSortMode("order");
      setFilter(bucket);
      setQPage(at === -1 ? 1 : Math.floor(at / QN_PAGE_SIZE) + 1);
      jumpTargetRef.current = questionId;
      setJumpNonce((n) => n + 1);
    },
    [answerMap, questions],
  );

  useEffect(() => {
    const target = jumpTargetRef.current;
    if (!target) return;
    jumpTargetRef.current = null;
    const el = document.getElementById(`question-${target}`);
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      document
        .getElementById("question-review")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [jumpNonce, filter, safePage]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Go back"
            onClick={handleBack}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {subjectLabel ? (
                <span className="text-[11px] font-bold tracking-[0.14em] text-primary uppercase">
                  {subjectLabel}
                </span>
              ) : null}
              {pending ? (
                <Badge variant="outline" className="gap-1.5 border-sky-500/30 text-sky-600 dark:text-sky-400">
                  <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
                  Grading
                </Badge>
              ) : flagged ? (
                <Badge variant="destructive" className="gap-1.5">
                  <ShieldAlertIcon className="size-3" /> Under review
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="gap-1.5 border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                >
                  <CheckCircle2Icon className="size-3" /> {isFinal ? "Graded" : "Submitted"}
                </Badge>
              )}
              {attempt.retakeOf ? (
                <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                  Retake
                </Badge>
              ) : null}
            </div>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-balance sm:text-[1.75rem]">
              {exam?.title ?? "Exam results"}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {submittedLabel ? (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarIcon className="size-3.5" />
                  <time>{submittedLabel}</time>
                </span>
              ) : null}
              {timeLabel ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  <TimerIcon className="size-3.5" /> {timeLabel} spent
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                {cleanSession ? (
                  <>
                    <ShieldCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                    Clean session
                  </>
                ) : (
                  <>
                    <ShieldAlertIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="tabular-nums">
                      {attempt.violationsCount} proctoring event
                      {attempt.violationsCount !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {isFinal && (
            <>
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={`/api/reports/attempt/${attempt.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                className="shadow-card"
              >
                <FileDownIcon data-icon="inline-start" />
                Download PDF
              </Button>
              <RetakeDialog
                attemptId={attempt.id}
                flagged={flagged}
                disabled={hasPendingRequest || hasOpenRetake}
                pendingLabel={hasPendingRequest}
                hasOpenRetake={hasOpenRetake}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Approved retake banner ── */}
      {hasOpenRetake && (
        <div className="flex items-start gap-3.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 shadow-card sm:p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Approved retake pending
            </p>
            <p className="mt-0.5 text-sm text-emerald-700/80 dark:text-emerald-300/80">
              An approved retake for this exam is still waiting to be completed. Finish that
              attempt before you can request another retake.
            </p>
          </div>
        </div>
      )}

      {/* ── Grading in progress ── */}
      {pending && (
        <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <ClockIcon className="size-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Grading in progress…</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Objective answers are scored instantly; essays take about a minute. Refresh this
                page to see your results.
              </p>
              <div className="bg-shimmer mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden />
            </div>
          </div>
        </div>
      )}

      {/* ── Flagged banner ── */}
      {flagged && (
        <div className="flex items-start gap-3.5 rounded-2xl border border-destructive/25 bg-destructive/[0.05] p-4 shadow-card sm:p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldAlertIcon className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-destructive">This attempt is under review</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your teacher is reviewing proctoring recordings for this session. Results will be
              released after the review.
            </p>
          </div>
        </div>
      )}

      {/* ── Score hero ── */}
      {score && meta && (
        <section
          aria-label="Score summary"
          className="bg-brand bg-noise shadow-glow relative overflow-hidden rounded-3xl text-white ring-1 ring-white/20"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(24rem 14rem at 12% -10%, rgba(255,255,255,.28), transparent 60%), radial-gradient(20rem 16rem at 95% 110%, rgba(255,255,255,.14), transparent 60%)",
            }}
          />
          <div className="relative flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center">
            <ScoreRing pct={score.percentage} stroke={meta.stroke} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="text-[11px] font-bold tracking-[0.18em] uppercase opacity-70">
                  Your score
                </p>
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
                  {meta.label}
                </span>
              </div>
              <p className="mt-2 text-sm opacity-85 tabular-nums">
                <span className="text-xl font-bold text-white">{score.earned}</span>
                <span className="opacity-70"> of {score.possible} marks earned</span>
                {missing > 0 ? (
                  <span className="opacity-70">
                    {" "}
                    · {missing} mark{missing !== 1 ? "s" : ""} from 100%
                  </span>
                ) : (
                  <span> · flawless</span>
                )}
              </p>
              <div className="mt-4 max-w-xl">
                <CompositionBar breakdown={marksBreakdown} />
              </div>
              <p className="mt-3 max-w-xl text-[13px] leading-relaxed opacity-75">
                {missing > 0
                  ? "Your roadmap below breaks down exactly where those marks went — and how to win them back."
                  : "Every mark earned. Review the breakdown below, then carry this standard into the next exam."}
              </p>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-3 border-t border-white/15 bg-black/10 p-4 sm:p-5 lg:grid-cols-4">
            <StatTile
              icon={TargetIcon}
              label="Accuracy"
              value={`${Math.round(score.percentage)}%`}
              sub={meta.label}
            />
            <StatTile
              icon={CheckCircle2Icon}
              label="Questions"
              value={`${counts.correct}/${questions.length}`}
              sub={`${counts.failed} failed · ${counts.skipped} skipped`}
            />
            <StatTile
              icon={TimerIcon}
              label="Pace"
              value={timeLabel ?? "—"}
              sub={paceLabel ?? "time not recorded"}
            />
            <StatTile
              icon={cleanSession ? ShieldCheckIcon : ShieldAlertIcon}
              label="Integrity"
              value={cleanSession ? "Clean" : `${attempt.violationsCount} flags`}
              sub={cleanSession ? "no incidents" : "see review note"}
            />
          </div>
        </section>
      )}

      {/* ── Verdict strip (pairs the hero with a plain-language verdict) ── */}
      {score && meta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <p className="text-sm text-muted-foreground">Overall verdict:</p>
          <p className={cn("text-lg font-bold", meta.verdict)}>{meta.label}</p>
          <span aria-hidden className="h-4 w-px bg-border" />
          <p className="text-sm text-muted-foreground">
            {cleanSession
              ? "Clean proctoring session."
              : `${attempt.violationsCount} proctoring event${attempt.violationsCount !== 1 ? "s" : ""} recorded.`}
          </p>
        </div>
      )}

      {/* ── AI feedback ── */}
      {feedback && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-400">
                <SparklesIcon className="size-5" />
              </span>
              AI feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Markdown className="prose-bridge text-pretty">{feedback.overall}</Markdown>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2Icon className="size-4" /> Strengths
                </p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {feedback.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <span aria-hidden className="text-emerald-600 dark:text-emerald-400">
                        •
                      </span>
                      <AnswerText text={s} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <TargetIcon className="size-4" /> Improve on
                </p>
                <ul className="mt-2.5 flex flex-col gap-2">
                  {feedback.improvements.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                      <span aria-hidden className="text-amber-600 dark:text-amber-400">
                        •
                      </span>
                      <AnswerText text={s} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Detailed assessment ── */}
      {exam && attempt.answers.length > 0 && isFinal && (
        <DetailedAssessment
          attempt={attempt}
          exam={exam}
          answerMap={answerMap}
          onSelectFilter={handleAssessmentFilter}
          onJumpToQuestion={handleJumpToQuestion}
        />
      )}

      {/* ── Question review ── */}
      {exam && attempt.answers.length > 0 && (
        <Card id="question-review" className="scroll-mt-20 shadow-card">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <BookOpenIcon className="size-5" />
                  </span>
                  Question review
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Correct answers, your responses, and explanations.
                </CardDescription>
              </div>
              {questions.length > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Showing {filteredQuestions.length === 0 ? 0 : pageOffset + 1}–
                  {Math.min(pageOffset + QN_PAGE_SIZE, filteredQuestions.length)} of{" "}
                  {filteredQuestions.length}
                </p>
              )}
            </div>
            {questions.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div
                  role="tablist"
                  aria-label="Filter questions by result"
                  className="flex w-fit flex-wrap gap-1 rounded-full border bg-muted/60 p-1"
                >
                  {FILTER_TABS.map((t) => {
                    const n = t.id === "all" ? questions.length : counts[t.id];
                    const active = filter === t.id;
                    return (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={active}
                        type="button"
                        onClick={() => handleFilter(t.id)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition-all tabular-nums",
                          active
                            ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t.label}{" "}
                        <span className={cn("tabular-nums", !active && "opacity-70")}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  aria-pressed={sortMode === "priority"}
                  onClick={handleSortToggle}
                  title="Failed first, then skipped, then correct"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    sortMode === "priority"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <TrendingUpIcon className="size-3.5" /> Priority first
                </button>
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {pagedQuestions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
                <TrendingUpIcon className="size-5 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing in this view</p>
                <p className="text-xs text-muted-foreground">
                  No questions match this filter — try another tab.
                </p>
              </div>
            ) : (
              pagedQuestions.map((q) => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  index={questionIndex.get(q.id) ?? 0}
                  answer={answerMap.get(q.id)}
                  perQFeedback={feedback?.perQuestion?.[q.id] ?? null}
                  bucket={bucketFor(answerMap.get(q.id))}
                  weightPct={weightShare(q.points, paperTotal)}
                />
              ))
            )}
            <Pagination page={safePage} totalPages={totalQPages} onPage={handleQPage} />
          </CardContent>
        </Card>
      )}

      {/* ── Footer note ── */}
      <p className="px-1 pb-2 text-center text-xs text-muted-foreground">
        Scores are final once graded. If something went wrong during your session, request a
        retake and your teacher will review it.
      </p>
    </div>
  );
}
