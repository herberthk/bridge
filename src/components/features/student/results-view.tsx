"use client";

import { useActionState, useCallback, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FileDownIcon,
  LightbulbIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TargetIcon,
  TrendingUpIcon,
  XCircleIcon,
} from "lucide-react";

import { requestRetakeAction } from "@/app/student/actions";
import { Markdown } from "@/components/markdown";
import { QuestionVisualView } from "@/components/features/exam/question-visual";
import { useActionToast } from "@/components/features/super/schools-manager";
import { answerMarkdown, correctMarkdown } from "@/lib/exam/answers";
import { summarizeQuestion } from "@/lib/exam/latex";
import type { AttemptDoc, ExamDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 65) return "text-lime-600 dark:text-lime-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function gradeLabel(pct: number): string {
  if (pct >= 80) return "Excellent";
  if (pct >= 65) return "Good";
  if (pct >= 50) return "Fair";
  return "Needs Work";
}

function gradeProgressColor(pct: number): string {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 65) return "bg-lime-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

// ─── AnswerText ───────────────────────────────────────────────────────────────

/**
 * An answer value rendered as maths-aware inline content.
 *
 * `Markdown` emits a `<div>`, so every call site here is a `<div>` too — these
 * panels used to be `<p>`s, and a div inside a paragraph is closed by the parser
 * before the answer ever reaches it. `prose-bridge` already zeroes the outer
 * margins of its first and last child, so a one-line answer sits flush inside its
 * chip while a multi-paragraph explanation still gets its rhythm.
 */
function AnswerText({
  text,
  emptyPlaceholder = "not answered",
}: {
  text: string | null;
  emptyPlaceholder?: string;
}) {
  if (!text) {
    return (
      <span className="text-muted-foreground font-normal italic">{emptyPlaceholder}</span>
    );
  }
  return <Markdown className="prose-bridge">{text}</Markdown>;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const QN_PAGE_SIZE = 10;

interface PaginationProps {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}

function Pagination({ page, totalPages, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between border-t px-2 py-3">
      <p className="text-muted-foreground text-xs">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
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
              className="flex size-8 items-center justify-center text-muted-foreground text-xs"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                p === page ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent",
              )}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

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
                className={`text-xs tabular-nums ${
                  reason.length < 10
                    ? "text-amber-600"
                    : reason.length > 500
                      ? "text-destructive"
                      : "text-muted-foreground"
                }`}
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
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    reason === c
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : "bg-muted hover:bg-accent"
                  }`}
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
            <p className="text-muted-foreground mt-1 text-xs">
              Be specific — teachers approve well-explained requests faster.
            </p>
            {state?.error && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangleIcon className="mr-1 inline size-3" /> {state.error}
              </motion.p>
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
              className="shadow-glow min-w-[132px] rounded-xl"
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

// ─── Detailed assessment ──────────────────────────────────────────────────────

function DetailedAssessment({
  attempt,
  exam,
}: {
  attempt: SerializedWithId<AttemptDoc>;
  exam: SerializedWithId<ExamDoc>;
}) {
  const isSkipped = (resp: unknown) => {
    if (resp === null || resp === undefined || resp === "") return true;
    if (Array.isArray(resp))
      return resp.length === 0 || resp.every((v) => v === "" || v === null || v === undefined);
    return false;
  };
  const failed: {
    q: (typeof exam.questions)[number];
    ans: (typeof attempt.answers)[number] | undefined;
  }[] = [];
  const skipped: typeof failed = [];
  const correct: typeof failed = [];
  for (const q of exam.questions) {
    const ans = attempt.answers.find((a) => a.questionId === q.id);
    const skippedFlag = !ans || isSkipped(ans.response);
    if (skippedFlag) skipped.push({ q, ans });
    else if (ans?.graded?.correct === false) failed.push({ q, ans });
    else if (ans?.graded?.correct === true) correct.push({ q, ans });
  }
  const total = exam.questions.length;
  const earned = attempt.score?.earned ?? 0;
  const possible = attempt.score?.possible ?? total;
  const missing = possible - earned;
  const feedback = attempt.feedback;

  if (total > 0 && correct.length === total) {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2Icon className="size-5" /> Perfect — 100% achieved
          </CardTitle>
          <CardDescription>
            You answered every question correctly. Keep this momentum for the next exam!
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

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
  const typeCounts = failed.reduce(
    (m, { q }) => m.set(q.type, (m.get(q.type) ?? 0) + 1),
    new Map<string, number>(),
  );
  const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topType)
    suggestions.push(
      `Practice more "${topType[0].replace(/_/g, " ")}" questions — you missed ${topType[1]} of that type.`,
    );

  return (
    <Card className="border-amber-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpenIcon className="size-5 text-amber-600" /> Detailed assessment — roadmap to 100%
        </CardTitle>
        <CardDescription>
          {failed.length} failed · {skipped.length} skipped · {correct.length} correct of {total} —
          you&apos;re{" "}
          <span className="font-semibold">
            {missing} mark{missing !== 1 ? "s" : ""}
          </span>{" "}
          from 100%.{" "}
          {attempt.retakeOf
            ? "This is a retake — compare with your previous attempt above."
            : "Review below to close the gap."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* KPI row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
            <p className="text-2xl font-semibold text-emerald-600">{correct.length}</p>
            <p className="text-muted-foreground text-xs">Correct</p>
          </div>
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-center">
            <p className="text-2xl font-semibold text-destructive">{failed.length}</p>
            <p className="text-muted-foreground text-xs">Failed</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center">
            <p className="text-2xl font-semibold text-amber-700">{skipped.length}</p>
            <p className="text-muted-foreground text-xs">Skipped</p>
          </div>
        </div>

        {/* Suggestions */}
        <div className="rounded-xl border bg-amber-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <LightbulbIcon className="size-4 text-amber-600" /> How to reach 100%
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {suggestions.slice(0, 5).map((s, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <TrendingUpIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                <AnswerText text={s} />
              </li>
            ))}
          </ul>
          {feedback?.perQuestion && (
            <p className="text-muted-foreground mt-2 text-xs">
              Tapped per-question AI feedback is also shown in the review below.
            </p>
          )}
        </div>

        {/* Failed list */}
        {failed.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <XCircleIcon className="size-4 text-destructive" /> Failed questions — what to fix
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {failed.map(({ q, ans }) => {
                const perQ = feedback?.perQuestion?.[q.id] ?? ans?.graded?.feedback ?? null;
                return (
                  <div key={q.id} className="rounded-xl border bg-card p-3">
                    <p className="text-sm font-medium">{summarizeQuestion(q.prompt, 120)}</p>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-muted p-2.5">
                        <span className="text-muted-foreground">Your answer</span>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-medium">
                          <AnswerText text={answerMarkdown(ans?.response, q)} />
                          <span className="text-destructive tabular-nums">
                            {ans?.graded?.earned ?? 0}/{q.points} marks
                          </span>
                        </div>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 p-2.5">
                        <span className="text-muted-foreground">Correct</span>
                        <div className="mt-0.5 font-medium">
                          <AnswerText
                            text={correctMarkdown(q)}
                            emptyPlaceholder="no model answer"
                          />
                        </div>
                      </div>
                    </div>
                    {(q.explanation || perQ) && (
                      <div className="text-muted-foreground mt-2 text-xs">
                        <p className="font-medium">Tip</p>
                        <AnswerText text={perQ ?? q.explanation} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Skipped list */}
        {skipped.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangleIcon className="size-4 text-amber-600" /> Skipped questions — easy gains
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {skipped.map(({ q }) => {
                const perQ = feedback?.perQuestion?.[q.id] ?? null;
                return (
                  <div key={q.id} className="rounded-xl border border-dashed bg-amber-500/5 p-3">
                    <p className="text-sm font-medium">{summarizeQuestion(q.prompt, 120)}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Skipped — you left this blank (0/{q.points}). Next time attempt it; even
                      partial credit helps.
                    </p>
                    {(q.explanation || perQ) && (
                      <div className="text-muted-foreground mt-1.5 text-xs">
                        <p className="font-medium">Study</p>
                        <AnswerText
                          text={
                            perQ ??
                            q.explanation ??
                            `Review ${exam.title} — ${q.type.replace(/_/g, " ")}`
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main ResultsView ─────────────────────────────────────────────────────────

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
  const [qPage, setQPage] = useState(1);

  const score = attempt.score;
  const feedback = attempt.feedback;
  const pending = attempt.status === "submitted";
  const flagged = attempt.status === "flagged";
  const graded = attempt.status === "graded" || attempt.status === "flagged";

  const questions = exam?.questions ?? [];
  const totalQPages = Math.max(1, Math.ceil(questions.length / QN_PAGE_SIZE));
  const pagedQuestions = questions.slice((qPage - 1) * QN_PAGE_SIZE, qPage * QN_PAGE_SIZE);

  function handleQPage(p: number) {
    setQPage(p);
    document
      .getElementById("question-review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => history.back()}>
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {exam?.title ?? "Exam results"}
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {attempt.autoSubmitted ? "Auto-submitted" : "Submitted"}
              {attempt.timeSpentSeconds
                ? ` · ${Math.round(attempt.timeSpentSeconds / 60)} min spent`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pending && (
            <Badge variant="secondary" className="gap-1.5">
              <ClockIcon className="size-3 animate-pulse" /> Grading…
            </Badge>
          )}
          {graded && (
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
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-sm">
              <CheckCircle2Icon className="size-4" /> Approved retake pending
            </CardTitle>
            <CardDescription className="text-emerald-700/80 dark:text-emerald-300/80">
              An approved retake for this exam is still waiting to be completed. Finish that attempt
              before you can request another retake.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ── Grading in progress banner ── */}
      {pending && (
        <div className="relative overflow-hidden rounded-2xl border bg-muted/40 p-5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "repeating-linear-gradient(45deg,currentColor 0,currentColor 1px,transparent 0,transparent 50%)",
              backgroundSize: "8px 8px",
            }}
          />
          <div className="relative flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
              <ClockIcon className="size-5 animate-pulse" />
            </div>
            <div>
              <p className="font-semibold">Grading in progress…</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Objective answers are scored instantly; essays take about a minute. Refresh this
                page to see your results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Flagged banner ── */}
      {flagged && (
        <div className="relative overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <ShieldAlertIcon className="size-5" />
            </div>
            <div>
              <p className="font-semibold text-destructive">This attempt is under review</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Your teacher is reviewing proctoring recordings for this session. Results will be
                released after the review.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Score hero ── */}
      {score && (
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Main score card */}
          <div className="bg-brand shadow-glow relative overflow-hidden rounded-2xl p-6 text-primary-foreground sm:col-span-2">
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(20rem 12rem at 15% 0%, rgba(255,255,255,.5), transparent 60%)",
              }}
            />
            <p className="relative text-xs font-medium uppercase tracking-widest opacity-70">
              Your score
            </p>
            <p className="relative mt-2 text-6xl font-bold tabular-nums">
              {score.percentage}%
            </p>
            {/* Score bar */}
            <div className="relative mt-4 h-2 w-full overflow-hidden rounded-full bg-white/20">
              <motion.div
                className={cn("h-full rounded-full", gradeProgressColor(score.percentage))}
                initial={{ width: 0 }}
                animate={{ width: `${score.percentage}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
            <p className="relative mt-2 text-sm opacity-75">
              {score.earned} of {score.possible} marks earned
            </p>
          </div>

          {/* Verdict card */}
          <Card className="flex flex-col justify-center">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TargetIcon className="size-4" /> Verdict
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className={cn("text-3xl font-bold", gradeColor(score.percentage))}>
                {gradeLabel(score.percentage)}
              </p>
              <p className="text-muted-foreground text-sm">
                {attempt.violationsCount > 0
                  ? `${attempt.violationsCount} proctoring event(s) recorded.`
                  : "Clean proctoring session."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── AI feedback ── */}
      {feedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4" /> AI Feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Markdown className="prose-bridge text-pretty">{feedback.overall}</Markdown>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2Icon className="size-4" /> Strengths
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {feedback.strengths.map((s, i) => (
                    <li key={i} className="text-muted-foreground flex gap-2 text-sm">
                      <span aria-hidden>•</span>
                      <AnswerText text={s} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <TargetIcon className="size-4" /> Improve on
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {feedback.improvements.map((s, i) => (
                    <li key={i} className="text-muted-foreground flex gap-2 text-sm">
                      <span aria-hidden>•</span>
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
      {exam && attempt.answers.length > 0 && graded && (
        <DetailedAssessment attempt={attempt} exam={exam} />
      )}

      {/* ── Question review (paginated) ── */}
      {exam && attempt.answers.length > 0 && (
        <Card id="question-review">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Question Review</CardTitle>
                <CardDescription className="mt-0.5">
                  Correct answers, your responses, and explanations.
                </CardDescription>
              </div>
              {questions.length > QN_PAGE_SIZE && (
                <p className="text-muted-foreground text-xs">
                  Showing Q{(qPage - 1) * QN_PAGE_SIZE + 1}–
                  {Math.min(qPage * QN_PAGE_SIZE, questions.length)} of {questions.length}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pagedQuestions.map((q, i) => {
              const globalIdx = (qPage - 1) * QN_PAGE_SIZE + i;
              const answer = attempt.answers.find((a) => a.questionId === q.id);
              const gradedAnswer = answer?.graded;
              return (
                <details key={q.id} className="group rounded-xl border">
                  <summary className="flex cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors hover:bg-accent/40">
                    {/* Status icon */}
                    <div className="shrink-0">
                      {gradedAnswer === null || gradedAnswer === undefined ? (
                        <div className="flex size-6 items-center justify-center rounded-full bg-muted">
                          <ClockIcon className="size-3.5 text-muted-foreground" />
                        </div>
                      ) : gradedAnswer.correct ? (
                        <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15">
                          <CheckCircle2Icon className="size-3.5 text-emerald-600" />
                        </div>
                      ) : (
                        <div className="flex size-6 items-center justify-center rounded-full bg-destructive/10">
                          <XCircleIcon className="size-3.5 text-destructive" />
                        </div>
                      )}
                    </div>

                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      Q{globalIdx + 1}. {summarizeQuestion(q.prompt, 80)}
                    </span>

                    {gradedAnswer && (
                      <Badge
                        variant={gradedAnswer.correct ? "secondary" : "outline"}
                        className={cn(
                          "shrink-0 tabular-nums text-xs",
                          gradedAnswer.correct
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "border-destructive/20 text-destructive",
                        )}
                      >
                        {gradedAnswer.earned}/{gradedAnswer.possible}
                      </Badge>
                    )}
                  </summary>

                  <div className="flex flex-col gap-4 border-t p-4">
                    <div className="text-sm">
                      <Markdown>{q.prompt}</Markdown>
                    </div>
                    {q.visual ? <QuestionVisualView visual={q.visual} /> : null}
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-xl bg-muted p-3">
                        <p className="text-muted-foreground mb-1 text-xs font-medium">
                          Your answer
                        </p>
                        <div className="font-medium">
                          <AnswerText text={answerMarkdown(answer?.response, q)} />
                        </div>
                      </div>
                      <div className="rounded-xl bg-emerald-500/10 p-3">
                        <p className="text-muted-foreground mb-1 text-xs font-medium">
                          Correct answer
                        </p>
                        <div className="font-medium">
                          <AnswerText
                            text={correctMarkdown(q)}
                            emptyPlaceholder="no model answer"
                          />
                        </div>
                      </div>
                    </div>
                    {q.explanation && (
                      <div className="rounded-xl bg-muted/60 p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs font-medium">
                          Explanation
                        </p>
                        <Markdown>{q.explanation}</Markdown>
                      </div>
                    )}
                    {q.workedExample && (
                      <div className="rounded-xl bg-muted/60 p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs font-medium">
                          Worked example
                        </p>
                        <Markdown>{q.workedExample}</Markdown>
                      </div>
                    )}
                    {(gradedAnswer?.feedback || feedback?.perQuestion?.[q.id]) && (
                      <div className="rounded-xl border p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs font-medium">
                          AI Feedback
                        </p>
                        <Markdown>
                          {feedback?.perQuestion?.[q.id] ?? gradedAnswer?.feedback ?? ""}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}

            <Pagination page={qPage} totalPages={totalQPages} onPage={handleQPage} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
