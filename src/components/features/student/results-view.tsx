"use client";

import { useActionState, useCallback, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileDownIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TargetIcon,
  XCircleIcon,
} from "lucide-react";

import { requestRetakeAction } from "@/app/student/actions";
import { Markdown } from "@/components/markdown";
import { useActionToast } from "@/components/features/super/schools-manager";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

function gradeColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 65) return "text-lime-600 dark:text-lime-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

const RETAKE_CHIPS = [
  "Internet dropped mid-exam",
  "Power outage",
  "Health issue",
  "Proctoring flagged incorrectly",
] as const;

function RetakeDialog({ attemptId, flagged }: { attemptId: string; flagged?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, formAction, pending] = useActionState<
    { ok: boolean; error?: string } | null,
    FormData
  >(requestRetakeAction, null);
  const closeDialog = useCallback(() => setOpen(false), []);
  useActionToast(state, closeDialog, "Retake requested — your teacher will review it.");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={flagged ? "default" : "outline"} className={flagged ? "shadow-glow" : ""} />}>
        <RotateCcwIcon data-icon="inline-start" />
        {flagged ? "Request retake — flagged" : "Request retake"}
      </DialogTrigger>
      <DialogContent className="overflow-hidden rounded-2xl border p-0 shadow-lifted sm:max-w-[520px]">
        <div className="bg-brand relative overflow-hidden p-6 text-primary-foreground">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-15" style={{ backgroundImage: "radial-gradient(18rem 10rem at 15% 0%, white, transparent 60%)" }} />
          <p className="relative inline-flex items-center gap-2 text-xs font-medium opacity-80"><ShieldAlertIcon className="size-3.5" /> Retake request</p>
          <DialogTitle className="relative mt-1 text-lg font-semibold text-white">Request a retake</DialogTitle>
          <DialogDescription className="relative mt-1 text-sm text-white/80">
            {flagged ? "Your attempt was flagged for review — explain what happened and your teacher will decide." : "Your teacher reviews every request. Pick a chip or write your reason (10–500 chars)."}
          </DialogDescription>
        </div>

        <form action={formAction} className="flex flex-col gap-4 p-6">
          <input type="hidden" name="attemptId" value={attemptId} />
          <Field>
            <FieldLabel htmlFor="reason" className="flex items-center justify-between">
              Reason <span className={`text-xs tabular-nums ${reason.length < 10 ? "text-amber-600" : reason.length > 500 ? "text-destructive" : "text-muted-foreground"}`}>{reason.length}/500</span>
            </FieldLabel>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {RETAKE_CHIPS.map((c) => (
                <button key={c} type="button" onClick={() => setReason(c)} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${reason === c ? "border-primary bg-primary text-primary-foreground shadow-glow" : "bg-muted hover:bg-accent"}`}>
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
              placeholder={flagged ? "e.g. My camera froze at question 8 — I stayed in the room and did not cheat…" : "e.g. I lost internet during question 12 and couldn't finish…"}
              className="min-h-[96px] rounded-xl border bg-card shadow-card"
            />
            <p className="text-muted-foreground mt-1 text-xs">Be specific — teachers approve well-explained requests faster.</p>
            {state?.error && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangleIcon className="mr-1 inline size-3" /> {state.error}
              </motion.p>
            )}
          </Field>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 10} className="shadow-glow min-w-[132px] rounded-xl">
              {pending ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Sending…
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

export function ResultsView({
  attempt,
  exam,
}: {
  attempt: SerializedWithId<AttemptDoc>;
  exam: SerializedWithId<ExamDoc> | null;
}) {
  const score = attempt.score;
  const feedback = attempt.feedback;
  const pending = attempt.status === "submitted";
  const flagged = attempt.status === "flagged";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={() => history.back()}>
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {exam?.title ?? "Exam results"}
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {attempt.autoSubmitted ? "Auto-submitted" : "Submitted"} ·{" "}
              {attempt.timeSpentSeconds
                ? `${Math.round(attempt.timeSpentSeconds / 60)} min spent`
                : ""}
            </p>
          </div>
        </div>
        {(attempt.status === "graded" || attempt.status === "flagged") && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<a href={`/api/reports/attempt/${attempt.id}`} target="_blank" rel="noopener noreferrer" />}>
              <FileDownIcon data-icon="inline-start" />
              Download PDF
            </Button>
            <RetakeDialog attemptId={attempt.id} flagged={flagged} />
          </div>
        )}
        {pending && (
          <Badge variant="secondary" className="hidden sm:inline-flex gap-1.5">
            <ClockIcon className="size-3 animate-pulse" /> Grading…
          </Badge>
        )}
      </div>

      {pending && (
        <Card className="bg-shimmer bg-muted/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClockIcon className="size-4 animate-pulse" />
              Grading in progress…
            </CardTitle>
            <CardDescription>
              Objective answers are scored instantly; essays take about a
              minute. Refresh this page to see your results.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {flagged && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive text-base">
              This attempt is under review
            </CardTitle>
            <CardDescription>
              Your teacher is reviewing proctoring recordings for this session.
              Results will be released after the review.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {score && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="bg-brand shadow-glow relative overflow-hidden rounded-2xl p-6 text-primary-foreground sm:col-span-2">
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(20rem 12rem at 15% 0%, rgba(255,255,255,.5), transparent 60%)",
              }}
            />
            <p className="relative text-sm opacity-80">Your score</p>
            <p className={`relative mt-1 text-5xl font-semibold tabular-nums`}>
              {score.percentage}%
            </p>
            <p className="relative mt-2 text-sm opacity-80">
              {score.earned} of {score.possible} marks
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TargetIcon className="size-4" />
                Verdict
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-semibold ${gradeColor(score.percentage)}`}>
                {score.percentage >= 80
                  ? "Excellent"
                  : score.percentage >= 65
                    ? "Good"
                    : score.percentage >= 50
                      ? "Fair"
                      : "Needs work"}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                {attempt.violationsCount > 0
                  ? `${attempt.violationsCount} proctoring event(s) recorded.`
                  : "Clean proctoring session."}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {feedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4" />
              AI feedback
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Markdown className="text-pretty leading-relaxed">
              {feedback.overall}
            </Markdown>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2Icon className="size-4 text-emerald-600" />
                  Strengths
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {feedback.strengths.map((s, i) => (
                    <li key={i} className="text-muted-foreground text-sm">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <TargetIcon className="size-4 text-amber-600" />
                  Improve on
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {feedback.improvements.map((s, i) => (
                    <li key={i} className="text-muted-foreground text-sm">
                      • {s}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-question review */}
      {exam && attempt.answers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Question review</CardTitle>
            <CardDescription>
              Correct answers, your responses, and explanations.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {exam.questions.map((q, i) => {
              const answer = attempt.answers.find((a) => a.questionId === q.id);
              const graded = answer?.graded;
              const correctText =
                q.type === "multiple_choice" && q.correctOptionIndex !== null
                  ? q.options?.[q.correctOptionIndex]
                  : q.type === "true_false"
                    ? q.correctBool
                      ? "True"
                      : "False"
                    : q.type === "matching"
                      ? q.pairs?.map((p) => p.right).join(", ")
                      : q.acceptableAnswers?.join(" / ");
              return (
                <details key={q.id} className="group rounded-xl border">
                  <summary className="hover:bg-accent/40 flex cursor-pointer items-center gap-3 rounded-xl p-4 transition-colors">
                    {graded === null || graded === undefined ? (
                      <Badge variant="outline">pending</Badge>
                    ) : graded.correct ? (
                      <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircleIcon className="text-destructive size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      Q{i + 1}. {q.prompt.replace(/[#*$_`]/g, "").slice(0, 80)}
                    </span>
                    {graded && (
                      <Badge variant="secondary" className="tabular-nums">
                        {graded.earned}/{graded.possible}
                      </Badge>
                    )}
                  </summary>
                  <div className="flex flex-col gap-4 border-t p-4">
                    <div className="text-sm">
                      <Markdown>{q.prompt}</Markdown>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-muted-foreground text-xs">Your answer</p>
                        <p className="mt-1 font-medium">
                          {formatResponse(answer?.response)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 p-3">
                        <p className="text-muted-foreground text-xs">Correct answer</p>
                        <p className="mt-1 font-medium">{correctText ?? "—"}</p>
                      </div>
                    </div>
                    {q.explanation && (
                      <div className="bg-muted/60 rounded-lg p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs">Explanation</p>
                        <Markdown>{q.explanation}</Markdown>
                      </div>
                    )}
                    {q.workedExample && (
                      <div className="bg-muted/60 rounded-lg p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs">Worked example</p>
                        <Markdown>{q.workedExample}</Markdown>
                      </div>
                    )}
                    {(graded?.feedback || feedback?.perQuestion?.[q.id]) && (
                      <div className="rounded-lg border p-3 text-sm">
                        <p className="text-muted-foreground mb-1 text-xs">Feedback</p>
                        <Markdown>
                          {feedback?.perQuestion?.[q.id] ?? graded?.feedback ?? ""}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatResponse(value: unknown): string {
  if (value === null || value === undefined || value === "") return "— not answered —";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "— not answered —";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String.fromCharCode(65 + value); // MC index
  return String(value);
}
