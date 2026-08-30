"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ref, uploadBytesResumable } from "firebase/storage";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  Loader2Icon,
  LockIcon,
  MonitorIcon,
  SendIcon,
  ShieldAlertIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import { authClient, storageClient } from "@/lib/firebase/client";
import { Markdown } from "@/components/markdown";
import { isAnswered, useExamSession } from "@/stores/exam-session";
import { useProctoring } from "@/components/features/exam/proctoring";
import { ExamOnboarding } from "@/components/features/exam/exam-onboarding";
import { QuestionVisualView } from "@/components/features/exam/question-visual";
import type { ExamSessionPolicy, StartedExam } from "@/lib/schemas/attempt";
import type { SafeQuestion } from "@/lib/schemas/attempt";
import { summarizeQuestion } from "@/lib/exam/latex";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/* ── Timer ring ────────────────────────────────────────────── */

const WARN_AT_MS = 5 * 60_000;
const FINAL_AT_MS = 60_000;

function TimerRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const pct = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const danger = remainingMs < WARN_AT_MS;

  // A ticking clock must not be announced every second — that would talk over
  // the question. The band is announced instead, and only when it changes.
  const band =
    remainingMs <= 0
      ? "Time is up."
      : remainingMs < FINAL_AT_MS
        ? "One minute remaining."
        : remainingMs < WARN_AT_MS
          ? "Five minutes remaining."
          : "";

  return (
    <div className="relative grid size-14 place-items-center" role="timer" aria-label={`Time remaining ${mm}:${ss}`}>
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="24" cy="24" r="20" fill="none"
          className="stroke-muted" strokeWidth="4"
        />
        <circle
          cx="24" cy="24" r="20" fill="none"
          className={danger ? "stroke-destructive" : "stroke-primary"}
          strokeWidth="4" strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 20}
          strokeDashoffset={2 * Math.PI * 20 * (1 - pct)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <span className={`text-xs font-semibold tabular-nums ${danger ? "text-destructive" : ""}`} aria-hidden>
        {mm}:{ss}
      </span>
      <span className="sr-only" aria-live="assertive">
        {band}
      </span>
    </div>
  );
}

/* ── Question inputs — premium, modern, aligned ───────────── */

/** Sentence case reads better in a badge than the Title Case shared labels. */
const TYPE_LABEL: Record<SafeQuestion["type"], string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  fill_in_the_blank: "Fill in the blank",
  short_answer: "Short answer",
  essay: "Essay",
  matching: "Matching",
};

function InlineBlankPrompt({
  prompt,
  blanks,
  value,
  onChange,
}: {
  prompt: string;
  blanks: number;
  value: string | string[] | undefined;
  onChange: (v: string[]) => void;
}) {
  const parts = useMemo(() => prompt.split(/_{2,}/), [prompt]);
  // If no ____ in prompt, fall back to separate inputs rendered by caller
  if (parts.length <= 1) return null;
  return (
    // The segments and their inputs flow as one sentence, so this is ordinary
    // inline layout — the wrapper used to carry `inline` together with
    // `flex-wrap items-baseline gap-x-2`, which is a contradiction: flex
    // properties are inert on an inline box, so the gaps never applied and the
    // baselines were whatever the inputs happened to sit at.
    <div className="text-pretty text-[15px] leading-8 sm:text-[17px] sm:leading-9">
      {parts.map((segment, idx) => (
        <span key={idx}>
          {segment && <Markdown className="inline [&_p]:inline [&_p]:m-0">{segment}</Markdown>}
          {idx < parts.length - 1 && (
            <Input
              placeholder={`Blank ${idx + 1}`}
              className="mx-1.5 inline-block h-8 w-[14ch] min-w-[10ch] rounded-full border-primary/20 bg-card px-3 align-baseline text-sm shadow-card focus-visible:ring-2 sm:h-9 sm:w-[18ch]"
              value={Array.isArray(value) ? (value[idx] ?? "") : ""}
              onChange={(e) => {
                const arr = Array.isArray(value) ? [...value] : Array(blanks).fill("");
                arr[idx] = e.target.value;
                onChange(arr);
              }}
              aria-label={`Blank ${idx + 1}`}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function QuestionView({
  question,
  value,
  onChange,
}: {
  question: SafeQuestion;
  value: string | string[] | number | boolean | undefined;
  onChange: (v: string | string[] | number | boolean) => void;
}) {
  const blanks = useMemo(
    () => (question.type === "fill_in_the_blank" ? (question.prompt.match(/_{2,}/g)?.length ?? 1) : 0),
    [question],
  );
  const hasInlineBlanks = question.type === "fill_in_the_blank" && question.prompt.includes("__");

  return (
    <div className="flex flex-col gap-6">
      {/* Prompt — premium card */}
      <div className="rounded-2xl border bg-card p-5 shadow-card sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <Badge variant="outline" className="shrink-0 border-primary/20 bg-primary/5 text-primary">
            {TYPE_LABEL[question.type] ?? question.type}
          </Badge>
          <span className="text-muted-foreground text-xs tabular-nums">{question.points} {question.points === 1 ? "mark" : "marks"}</span>
        </div>
        <div className="mt-3">
          {hasInlineBlanks ? (
            <InlineBlankPrompt
              prompt={question.prompt}
              blanks={blanks}
              value={Array.isArray(value) ? value : undefined}
              onChange={(arr) => onChange(arr)}
            />
          ) : (
            <div className="text-pretty text-[15px] sm:text-[17px]">
              <Markdown className="prose-bridge">{question.prompt}</Markdown>
            </div>
          )}
        </div>
        {question.visual && (
          <div className="mt-4">
            <QuestionVisualView visual={question.visual} />
          </div>
        )}
      </div>

      {question.type === "multiple_choice" && question.options && (
        <div
          role="radiogroup"
          aria-label="Answer options"
          className="grid gap-3 sm:grid-cols-2"
        >
          {question.options.map((opt, i) => {
            const selected = value === i;
            return (
              <label
                key={i}
                className={cn(
                  "group relative flex cursor-pointer items-start gap-3 rounded-2xl border p-4 pr-3 text-left transition-all duration-200 will-change-transform hover:shadow-lifted",
                  // Keyboard users move through the options with the arrow keys,
                  // and the radio itself is `sr-only` — without this the focused
                  // option was completely invisible.
                  "has-[input:focus-visible]:ring-ring/60 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-background",
                  selected
                    ? "border-primary bg-primary/6 shadow-glow"
                    : "bg-card hover:bg-accent/40",
                )}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors ${
                    selected ? "border-primary bg-primary text-primary-foreground shadow-glow" : "border-border bg-muted text-muted-foreground group-hover:border-primary/30"
                  }`}
                  aria-hidden
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <div className="min-w-0 flex-1 pt-1 text-sm leading-relaxed sm:text-[14px]">
                  <Markdown className="prose-bridge">{opt}</Markdown>
                </div>
                <input type="radio" name={question.id} className="sr-only" checked={selected} onChange={() => onChange(i)} />
                {selected && <span className="absolute inset-0 rounded-2xl border border-primary/20 pointer-events-none" aria-hidden />}
              </label>
            );
          })}
        </div>
      )}

      {question.type === "true_false" && (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="True or false">
          {[
            { label: "True", val: true },
            { label: "False", val: false },
          ].map((opt) => {
            const selected = value === opt.val;
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(opt.val)}
                className={`group relative rounded-2xl border px-6 py-6 text-base font-semibold transition-all duration-200 will-change-transform hover:shadow-lifted ${
                  selected ? "border-primary bg-primary text-primary-foreground shadow-glow" : "bg-card hover:bg-accent/40"
                }`}
              >
                <span className={`mx-auto grid size-9 place-items-center rounded-full border text-sm font-bold ${selected ? "border-white/20 bg-white/15 text-white" : "border-border bg-muted text-muted-foreground"}`} aria-hidden>
                  {opt.label[0]}
                </span>
                <span className="mt-2 block">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {question.type === "fill_in_the_blank" && !hasInlineBlanks && (
        <div className="grid gap-2.5">
          {Array.from({ length: blanks }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-card">
              <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <Input
                placeholder={`Blank ${i + 1}`}
                className="h-11 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                value={Array.isArray(value) ? (value[i] ?? "") : ""}
                onChange={(e) => {
                  const arr = Array.isArray(value) ? [...value] : Array(blanks).fill("");
                  arr[i] = e.target.value;
                  onChange(arr);
                }}
              />
            </div>
          ))}
          {blanks === 0 && (
            <div className="rounded-2xl border bg-card p-3 shadow-card">
              <Input
                className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
                placeholder="Your answer"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {question.type === "short_answer" && (
        <div className="rounded-2xl border bg-card p-3 shadow-card">
          <Input
            className="h-12 rounded-xl border-0 bg-muted/40 px-4 shadow-none focus-visible:bg-card focus-visible:ring-2"
            placeholder="Type your answer…"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}

      {question.type === "essay" && (
        <div className="rounded-2xl border bg-card p-1 shadow-card">
          <Textarea
            rows={9}
            placeholder="Write your answer here. You can use multiple paragraphs…"
            className="min-h-[160px] resize-y rounded-xl border-0 bg-muted/30 p-4 shadow-none focus-visible:bg-card focus-visible:ring-2"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
          <div className="flex justify-end px-3 pb-2 pt-1">
            <span className="text-muted-foreground text-[11px] tabular-nums">{typeof value === "string" ? value.trim().split(/\s+/).filter(Boolean).length : 0} words</span>
          </div>
        </div>
      )}

      {question.type === "matching" && question.pairs && (
        <div className="grid gap-3">
          {question.pairs.map((pair, i) => (
            <div key={i} className="grid grid-cols-1 items-center gap-3 rounded-2xl border bg-card p-3 shadow-card sm:grid-cols-[1fr_12px_1fr]">
              <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                <Markdown>{pair.left}</Markdown>
              </div>
              <span className="hidden place-items-center text-muted-foreground sm:grid">→</span>
              <Input
                placeholder={`Match for ${i + 1}`}
                className="h-11 rounded-xl bg-muted/30"
                value={Array.isArray(value) ? (value[i] ?? "") : ""}
                onChange={(e) => {
                  const arr = Array.isArray(value) ? [...value] : Array(question.pairs?.length ?? 0).fill("");
                  arr[i] = e.target.value;
                  onChange(arr);
                }}
              />
            </div>
          ))}
          <p className="text-muted-foreground rounded-xl border border-dashed bg-muted/20 p-3 text-xs">Type the matching item exactly as shown in the question bank.</p>
        </div>
      )}

      {question.hint && (
        <details className="group rounded-2xl border bg-card shadow-card">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium hover:text-foreground">
            <span className="grid size-6 place-items-center rounded-full bg-amber-500/15 text-amber-600">💡</span> Show hint
          </summary>
          <div className="border-t bg-muted/30 p-4 text-sm">
            <Markdown>{question.hint}</Markdown>
          </div>
        </details>
      )}
    </div>
  );
}

/* ── Paper overview ──────────────────────────────────────── */

const SEGMENT_TONE = {
  current: "h-2.5 bg-primary shadow-glow",
  flagged: "h-1.5 bg-amber-500",
  answered: "h-1.5 bg-success",
  todo: "h-1.5 bg-muted-foreground/25",
} as const;

type SegmentState = keyof typeof SEGMENT_TONE;

/**
 * Whole-paper progress strip.
 *
 * One fixed-size dot per question does not survive a 60-question paper: the row
 * was wider than a phone and pushed the Next button off the footer. Segments
 * share whatever width exists instead, so the strip reads the same at 10
 * questions or 60.
 *
 * It subscribes to the store itself rather than taking `answers` as a prop. The
 * answer map changes on every keystroke and this is the only part of the footer
 * that has to react to that — reading it in the runner re-rendered the timer
 * ring and every chart in the current question along with it.
 */
function QuestionStrip({
  allowJump,
  allowForward,
  onJump,
}: {
  allowJump: boolean;
  allowForward: boolean;
  onJump: (index: number) => void;
}) {
  const questions = useExamSession((s) => s.questions);
  const answers = useExamSession((s) => s.answers);
  const flagged = useExamSession((s) => s.flagged);
  const current = useExamSession((s) => s.current);

  const states: SegmentState[] = questions.map((q, i) =>
    i === current
      ? "current"
      : flagged.has(q.id)
        ? "flagged"
        : isAnswered(answers[q.id])
          ? "answered"
          : "todo",
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {allowJump ? (
        <nav
          aria-label="Question navigation"
          className="flex min-w-0 flex-1 items-center gap-[3px]"
        >
          {questions.map((q, i) => {
            // Forward jumps are only legitimate where the paper allows skipping;
            // otherwise they would step over the answer-required gate that
            // `handleNext` enforces.
            const jumpable = i !== current && (i < current || allowForward);
            return (
              <button
                key={q.id}
                type="button"
                disabled={!jumpable}
                onClick={() => onJump(i)}
                aria-current={i === current ? "step" : undefined}
                aria-label={`Question ${i + 1}, ${states[i] === "current" ? "current question" : states[i]}`}
                className={cn(
                  "min-w-[3px] flex-1 rounded-full transition-all",
                  "focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                  jumpable ? "cursor-pointer hover:h-2.5" : "cursor-default",
                  SEGMENT_TONE[states[i]!],
                )}
              />
            );
          })}
        </nav>
      ) : (
        // A linear paper has nothing to navigate to, and 60 dead controls is pure
        // noise in a screen reader — the header already announces position.
        <div aria-hidden className="flex min-w-0 flex-1 items-center gap-[3px]">
          {questions.map((q, i) => (
            <span
              key={q.id}
              className={cn("min-w-[3px] flex-1 rounded-full transition-all", SEGMENT_TONE[states[i]!])}
            />
          ))}
        </div>
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {current + 1}/{questions.length}
      </span>
    </div>
  );
}

/**
 * Pre-submit review.
 *
 * `allowReviewBeforeSubmit` was in the policy type and read nowhere, so the
 * confirmation dialog said "make sure you have answered all the questions" while
 * the app already knew exactly which ones were blank. Only the outstanding
 * questions are listed — a full 60-row list is not a review, it is a wall.
 */
function SubmitReview({
  showOutstanding,
  allowJump,
  allowForward,
  onJump,
}: {
  showOutstanding: boolean;
  allowJump: boolean;
  allowForward: boolean;
  onJump: (index: number) => void;
}) {
  const questions = useExamSession((s) => s.questions);
  const answers = useExamSession((s) => s.answers);
  const flagged = useExamSession((s) => s.flagged);
  const current = useExamSession((s) => s.current);

  const { answered, outstanding } = useMemo(() => {
    const rows = questions.map((q, index) => ({
      index,
      id: q.id,
      answered: isAnswered(answers[q.id]),
      flagged: flagged.has(q.id),
      label: summarizeQuestion(q.prompt, 68),
      points: q.points,
    }));
    return {
      answered: rows.filter((r) => r.answered).length,
      outstanding: rows.filter((r) => !r.answered || r.flagged),
    };
  }, [questions, answers, flagged]);

  const blank = questions.length - answered;
  const lostMarks = outstanding
    .filter((r) => !r.answered)
    .reduce((sum, r) => sum + (r.points ?? 0), 0);

  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="tabular-nums gap-1">
          <CheckCircle2Icon className="size-3 text-success" /> {answered} answered
        </Badge>
        <Badge
          variant={blank > 0 ? "destructive" : "outline"}
          className="tabular-nums gap-1"
        >
          <AlertTriangleIcon className="size-3" /> {blank} unanswered
        </Badge>
        {flagged.size > 0 && (
          <Badge variant="outline" className="tabular-nums gap-1 border-amber-300 text-amber-700 dark:border-amber-900/50 dark:text-amber-300">
            <FlagIcon className="size-3" /> {flagged.size} flagged
          </Badge>
        )}
      </div>

      {blank > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          Unanswered questions score zero — {lostMarks} {lostMarks === 1 ? "mark" : "marks"} at
          stake.
        </p>
      )}

      {showOutstanding && outstanding.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto pr-1">
          {outstanding.map((row) => {
            const body = (
              <>
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  Q{row.index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {row.label}
                </span>
                {row.flagged && <FlagIcon className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
                {!row.answered && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                    blank
                  </span>
                )}
              </>
            );
            return (
              <li key={row.id}>
                {allowJump && row.index !== current && (row.index < current || allowForward) ? (
                  <button
                    type="button"
                    onClick={() => onJump(row.index)}
                    className="flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-accent/40"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex w-full items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Draft persistence ───────────────────────────────────── */

/** Session-scoped draft persistence — answers survive an accidental refresh.
 *  sessionStorage (not localStorage) so drafts never outlive the tab session. */
const draftKey = (attemptId: string) => `bridge:exam-draft:${attemptId}`;

function saveDraft(
  attemptId: string,
  answers: Record<string, unknown>,
  deadlineMs: number,
) {
  try {
    sessionStorage.setItem(
      draftKey(attemptId),
      JSON.stringify({ answers, deadlineMs, savedAt: Date.now() }),
    );
  } catch {
    // Storage full/blocked — best-effort only.
  }
}

function loadDraft(
  attemptId: string,
): { answers: Record<string, string | string[] | number | boolean>; deadlineMs: number } | null {
  try {
    const raw = sessionStorage.getItem(draftKey(attemptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      answers: Record<string, string | string[] | number | boolean>;
      deadlineMs: number;
    };
    // Expired drafts are worthless — the attempt is past its deadline.
    return parsed.deadlineMs > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

/* ── Runner ────────────────────────────────────────────────── */

type Phase = "onboarding" | "exam" | "submitting" | "terminated";

const DEFAULT_POLICY: ExamSessionPolicy = {
  preventBacktrack: true,
  allowReviewBeforeSubmit: false,
  allowSkipping: true,
  requireFullscreen: true,
  enableCameraRecording: false,
  enableScreenRecording: false,
};

export function ExamRunner({
  attemptId,
  examTitle,
  durationMinutes,
  questionCount,
  policy,
}: {
  attemptId: string;
  examTitle: string;
  durationMinutes: number;
  questionCount: number;
  policy?: ExamSessionPolicy;
}) {
  const router = useRouter();
  // Atomic selectors, not `useExamSession()`. Subscribing to the whole store
  // re-rendered this tree — timer ring, 60-segment strip, every chart in the
  // current question — on each keystroke of an essay answer. The answer map is
  // deliberately absent here: `answered` is a number, so it only fires when the
  // count actually moves, and the parts that need the map read it themselves.
  const sessionTitle = useExamSession((s) => s.examTitle);
  const questions = useExamSession((s) => s.questions);
  const currentIndex = useExamSession((s) => s.current);
  const flagged = useExamSession((s) => s.flagged);
  const hydrate = useExamSession((s) => s.hydrate);
  const setAnswer = useExamSession((s) => s.setAnswer);
  const setCurrent = useExamSession((s) => s.setCurrent);
  const toggleFlag = useExamSession((s) => s.toggleFlag);
  const answered = useExamSession((s) =>
    s.questions.reduce((n, q) => n + (isAnswered(s.answers[q.id]) ? 1 : 0), 0),
  );
  const answerValue = useExamSession((s) => {
    const q = s.questions[s.current];
    return q ? s.answers[q.id] : undefined;
  });
  const reduceMotion = useReducedMotion();
  const effectivePolicy = useMemo(() => policy ?? DEFAULT_POLICY, [policy]);
  const [phase, setPhase] = useState<Phase>("onboarding");
  const [meta, setMeta] = useState<{
    durationMinutes: number;
    deadlineMs: number;
  } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [warning, setWarning] = useState<{ count: number; reason: string } | null>(null);
  const submittedRef = useRef(false);
  const clockRef = useRef<Worker | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const startMsRef = useRef<number>(0);
  const doSubmitRef = useRef<(auto: boolean) => Promise<void>>(null!);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [submitStage, setSubmitStage] = useState<"answers" | "recordings" | "finalizing">("answers");
  const [uploadProgress, setUploadProgress] = useState({ camera: 0, screen: 0 });

  const recordingEnabled = effectivePolicy.enableCameraRecording || effectivePolicy.enableScreenRecording;

  const rig = useProctoring(
    attemptId,
    {
      onWarning: (count, violation) =>
        setWarning({ count, reason: violation.reason ?? violation.type.replace(/_/g, " ") }),
      onTerminate: () => {
        setPhase("terminated");
        void doSubmitRef.current?.(true);
      },
    },
    {
      enableCameraRecording: effectivePolicy.enableCameraRecording,
      enableScreenRecording: effectivePolicy.enableScreenRecording,
    },
  );

  // Camera PIP preview.
  useEffect(() => {
    if (cameraPreviewRef.current && rig.cameraStream) {
      cameraPreviewRef.current.srcObject = rig.cameraStream;
      void cameraPreviewRef.current.play().catch(() => undefined);
    }
  }, [rig.cameraStream, phase]);

  // Fullscreen lock tracking (only when required)
  useEffect(() => {
    if (!effectivePolicy.requireFullscreen || phase !== "exam") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync fullscreen flag to policy/phase
      setIsFullscreen(true);
      return;
    }
    const check = () => setIsFullscreen(!!document.fullscreenElement);
    check();
    document.addEventListener("fullscreenchange", check);
    return () => document.removeEventListener("fullscreenchange", check);
  }, [phase, effectivePolicy.requireFullscreen]);

  const startExam = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/start`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | (StartedExam & { ok: true })
        | { error: string }
        | null;
      if (!res.ok || !data || !("ok" in data)) {
        setStartError(data && "error" in data ? data.error : "Could not start the exam.");
        return;
      }
      // Restore any in-session draft (e.g. after an accidental refresh).
      const draft = loadDraft(attemptId);
      hydrate({
        attemptId,
        examTitle: data.examTitle,
        questions: data.questions,
        deadlineMs: data.deadlineMs,
        answers: draft?.answers ?? {},
      });
      setMeta({ durationMinutes: data.durationMinutes, deadlineMs: data.deadlineMs });
      startMsRef.current = Date.now();
      if (draft && Object.keys(draft.answers).length > 0) {
        toast.info("Your previous answers were restored.");
      }

      await rig.beginExamCapture();
      if (effectivePolicy.requireFullscreen) {
        await document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
      setPhase("exam");
      try {
        sessionStorage.removeItem("bridge:onboarding-step");
      } catch {}

      // Worker-driven countdown.
      const worker = new Worker(
        new URL("../../../workers/exam-clock.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent) => {
        const { remaining, expired } = event.data as { remaining: number; expired: boolean };
        setRemainingMs(remaining);
        if (expired && !submittedRef.current) {
          toast.error("Time is up — submitting your exam.");
          void doSubmitRef.current?.(true);
        }
      };
      worker.postMessage({ type: "init", deadlineMs: data.deadlineMs });
      clockRef.current = worker;
    } catch {
      setStartError("Network error — check your connection and try again.");
    } finally {
      setStarting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, hydrate, rig.beginExamCapture]);

  // Autosave answers to sessionStorage every few seconds while in the exam.
  useEffect(() => {
    if (phase !== "exam") return;
    const timer = setInterval(() => {
      if (meta?.deadlineMs) {
        saveDraft(attemptId, useExamSession.getState().answers, meta.deadlineMs);
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [phase, attemptId, meta?.deadlineMs]);

  const uploadRecordings = useCallback(
    async (cameraBlob: Blob | null, screenBlob: Blob | null) => {
      const storage = storageClient();
      const uid = authClient().currentUser?.uid ?? null;
      // Prefer UID-isolated path (no Firestore lookup, never races) — fallback to legacy attemptId-only path
      const basePath = uid ? `recordings/${uid}/${attemptId}` : `recordings/${attemptId}`;
      if (!uid) {
        console.warn("[exam] no Firebase Auth user — upload will use legacy path and may hit rules; ensure you are signed in via Firebase Auth, not just session cookie");
      }
      let cameraPath: string | null = null;
      let screenPath: string | null = null;

      const uploadWithProgress = (path: string, blob: Blob, onPct: (p: number) => void) =>
        new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(ref(storage, path), blob, { contentType: "video/webm" });
          task.on(
            "state_changed",
            (snap) => {
              const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
              onPct(pct);
            },
            (err) => reject(err),
            () => resolve(),
          );
        });

      const tryUpload = async (path: string, blob: Blob, onPct: (p: number) => void): Promise<string | null> => {
        try {
          await uploadWithProgress(path, blob, onPct);
          return path;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code ?? "";
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[exam] recording upload failed for ${path}`, { code, msg, uid, hasAuth: !!uid });
          if (code === "storage/unauthorized" || code.includes("unauthorized")) {
            // One-time fallback to legacy path if we tried UID-isolated first
            if (uid && path.startsWith(`recordings/${uid}/`)) {
              const legacy = path.replace(`recordings/${uid}/`, "recordings/");
              console.warn(`[exam] retrying upload to legacy path ${legacy}`);
              try {
                await uploadWithProgress(legacy, blob, onPct);
                // Return the legacy path that actually succeeded for the DB reference
                return legacy;
              } catch (retryErr) {
                console.warn("[exam] legacy retry also failed", retryErr);
                // Non-fatal: answers are already secured, recordings are secondary
                toast.error("Recordings could not be uploaded — your answers are safe. An admin can still grade without video.");
                return null;
              }
            }
            toast.error("Recording upload blocked by Storage rules — your answers are safe. Tell an admin to run: firebase deploy --only storage");
          }
          return null;
        }
      };

      // Unique filenames per upload to never overwrite — timestamp + short uuid
      const ts = Date.now();
      const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 8);
      if (cameraBlob) {
        const initialPath = `${basePath}/camera-${ts}-${rnd}.webm`;
        const effectivePath = await tryUpload(initialPath, cameraBlob, (p) => setUploadProgress((s) => ({ ...s, camera: p })));
        cameraPath = effectivePath;
      } else {
        setUploadProgress((s) => ({ ...s, camera: 100 }));
      }
      if (screenBlob) {
        // Use same ts/rnd prefix but distinct file kind for easy grouping, still unique per file
        const screenRnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 8);
        const initialPath = `${basePath}/screen-${ts}-${screenRnd}.webm`;
        const effectivePath = await tryUpload(initialPath, screenBlob, (p) => setUploadProgress((s) => ({ ...s, screen: p })));
        screenPath = effectivePath;
      } else {
        setUploadProgress((s) => ({ ...s, screen: 100 }));
      }
      if (cameraPath || screenPath) {
        await fetch(`/api/attempts/${attemptId}/recording`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cameraPath, screenPath }),
        }).catch(() => undefined);
      }
    },
    [attemptId],
  );

  /** Answers-only POST — deadline-critical path. Recordings follow later so a
   *  slow video upload can never push a student past the server deadline. */
  const submitAnswers = useCallback(
    async (auto: boolean): Promise<{ ok: boolean; status?: number; message?: string }> => {
      const state = useExamSession.getState();
      const answers = Object.entries(state.answers).map(([questionId, response]) => ({
        questionId,
        response,
      }));
      const timeSpentSeconds = Math.max(
        0,
        Math.round((Date.now() - startMsRef.current) / 1000),
      );
      const res = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, autoSubmitted: auto, timeSpentSeconds }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      return {
        ok: res.ok,
        status: res.status,
        message: data && "error" in data ? data.error : undefined,
      };
    },
    [attemptId],
  );

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setPhase("submitting");
      setSubmitStage("answers");
      setUploadProgress({ camera: 0, screen: 0 });
      clockRef.current?.postMessage({ type: "stop" });

      try {
        // 1) Answers first — this is what the server deadline judges.
        const result = await submitAnswers(auto);
        if (!result.ok) {
          if (result.status === 409 || result.status === 410) {
            const errorMsg = result.message || "This exam has already been submitted.";
            toast.error(errorMsg);
            if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
            router.replace(`/student/results/${attemptId}`);
            return;
          }
          throw new Error(result.message || "rejected");
        }

        try {
          sessionStorage.removeItem(draftKey(attemptId));
        } catch {}

        // 2) Recordings — stop capture after successful answers (only if admin enabled)
        if (recordingEnabled) {
          setSubmitStage("recordings");
          const { cameraBlob, screenBlob } = await rig.stopEverything();
          await uploadRecordings(cameraBlob, screenBlob);
        } else {
          // Still stop snapshot/monitoring even when recordings are disabled
          await rig.stopEverything();
          setUploadProgress({ camera: 100, screen: 100 });
        }

        setSubmitStage("finalizing");
        // brief pause so user sees completion
        await new Promise((r) => setTimeout(r, 500));

        if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
        toast.success("Submitted!", {
          description: recordingEnabled
            ? effectivePolicy.requireFullscreen
              ? "Exam secured — recordings uploaded."
              : "Exam submitted — recordings uploaded."
            : "Exam submitted — answers secured.",
        });
        router.replace(`/student/results/${attemptId}`);
      } catch (err) {
        submittedRef.current = false;
        setPhase("exam");
        clockRef.current?.postMessage({ type: "resume" });
        const errorMsg = err instanceof Error ? err.message : "Submission failed — check your connection and try again.";
        toast.error(errorMsg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId, rig.stopEverything, uploadRecordings, submitAnswers, router, effectivePolicy.requireFullscreen, recordingEnabled],
  );

  // Keep the submit indirection fresh for proctoring/worker callbacks.
  useEffect(() => {
    doSubmitRef.current = doSubmit;
  });

  // Fullscreen lock helper + navigation helpers — defined before early returns to satisfy rules-of-hooks
  const current = questions[currentIndex];
  const progressPct = questions.length ? (answered / questions.length) * 100 : 0;
  const hasAnswer = isAnswered(answerValue);
  const canGoNext = effectivePolicy.allowSkipping || hasAnswer;
  const isLast = currentIndex === questions.length - 1;
  const isFlagged = current ? flagged.has(current.id) : false;

  const reenterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } catch {}
  }, []);

  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const handleNext = useCallback(() => {
    // Read through the store rather than the render-time snapshot: the click can
    // land in the same tick as the keystroke that answered the question.
    const state = useExamSession.getState();
    const cur = state.questions[state.current];
    const answeredNow = cur ? isAnswered(state.answers[cur.id]) : false;
    if (!effectivePolicy.allowSkipping && !answeredNow) {
      toast.error("Answer required before continuing.", { description: "This exam does not allow skipping." });
      return;
    }
    if (state.current === state.questions.length - 1) {
      setConfirmSubmit(true);
    } else {
      state.setCurrent(state.current + 1);
    }
  }, [effectivePolicy.allowSkipping]);

  const handlePrevious = useCallback(() => {
    if (effectivePolicy.preventBacktrack) return;
    setCurrent(useExamSession.getState().current - 1);
  }, [effectivePolicy.preventBacktrack, setCurrent]);

  /** Jump target from the strip or the review list. Blocked outright in a linear
   *  paper; forward only where skipping is allowed, so a jump can never step over
   *  the answer-required gate `handleNext` enforces. */
  const jumpTo = useCallback(
    (index: number) => {
      if (effectivePolicy.preventBacktrack) return;
      const state = useExamSession.getState();
      if (index === state.current) return;
      if (index > state.current && !effectivePolicy.allowSkipping) return;
      state.setCurrent(index);
    },
    [effectivePolicy.preventBacktrack, effectivePolicy.allowSkipping],
  );

  // Warn on manual close/refresh mid-exam.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (phase === "exam" && !submittedRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  useEffect(() => () => clockRef.current?.terminate(), []);

  /* ── Render ─────────────────────────────────────────────── */

  if (phase === "onboarding") {
    return (
      <ExamOnboarding
        examTitle={examTitle}
        durationMinutes={durationMinutes}
        questionCount={questionCount}
        permissionError={rig.permissionError}
        permissionsGranted={permissionsGranted}
        cameraStream={rig.cameraStream}
        screenStream={rig.screenStream}
        onGrantPermissions={async () => {
          const ok = await rig.requestPermissions();
          setPermissionsGranted(ok);
        }}
        onStart={() => void startExam()}
        onExit={() => router.replace("/student")}
        starting={starting}
        error={startError}
        policy={effectivePolicy}
      />
    );
  }

  if (phase === "terminated") {
    return (
      <div className="bg-mesh flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
          <ShieldAlertIcon className="size-8" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Exam ended</h1>
        <p className="text-muted-foreground max-w-md text-pretty">
          The exam was submitted automatically after repeated integrity
          violations. Your teacher has been notified and will review the
          session recordings.
        </p>
        <Button variant="outline" onClick={() => router.replace("/student")}>
          Back to dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-mesh bg-noise flex min-h-dvh flex-col select-none">
      {/* Premium header — glass + brand accent */}
      <header className="glass sticky top-0 z-40 border-b">
        <div className="flex h-[64px] items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="hidden size-9 place-items-center rounded-xl bg-brand text-primary-foreground shadow-glow sm:grid">
              <SparklesIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">{sessionTitle || examTitle}</p>
              {/* `sr-only` rather than `hidden` on small screens: this is the
                  only place a screen reader learns where it is in the paper, and
                  the strip below is decorative in a linear exam. */}
              <p
                aria-live="polite"
                className="text-xs tabular-nums text-muted-foreground max-sm:sr-only"
              >
                Question {currentIndex + 1} of {questions.length} · {answered}/{questions.length} answered
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            {effectivePolicy.preventBacktrack && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 gap-1">
                <LockIcon className="size-3" /> Linear — no back
              </Badge>
            )}
            {!effectivePolicy.allowSkipping && (
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">No skipping</Badge>
            )}
            {effectivePolicy.requireFullscreen && (
              <Badge variant={isFullscreen ? "secondary" : "destructive"} className="gap-1">
                <MonitorIcon className="size-3" /> {isFullscreen ? "Fullscreen" : "Exit detected"}
              </Badge>
            )}
          </div>

          <Badge variant="secondary" className="hidden sm:inline-flex tabular-nums">
            {answered}/{questions.length} answered
          </Badge>

          <TimerRing remainingMs={remainingMs} totalMs={(meta?.durationMinutes ?? 0) * 60_000} />

          <div className="relative ml-1 hidden size-14 overflow-hidden rounded-xl border-2 border-primary/30 bg-black shadow-card sm:block">
            <video ref={cameraPreviewRef} muted playsInline className="size-full object-cover" />
            <span
              className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none text-white ${recordingEnabled ? "bg-emerald-500" : "bg-slate-600"}`}
            >
              {recordingEnabled ? "● REC" : "● LIVE"}
            </span>
          </div>
        </div>
        {/* Single premium progress bar — overall exam progress */}
        <Progress value={progressPct} className="rounded-none">
          <ProgressTrack className="h-[3px] rounded-none bg-muted/30">
            <ProgressIndicator className="bg-brand shadow-glow" />
          </ProgressTrack>
        </Progress>
      </header>

      {/* Fullscreen lock overlay — premium, blocks interaction when required */}
      {effectivePolicy.requireFullscreen && !isFullscreen && phase === "exam" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-md">
          <motion.div initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="shadow-lifted w-full max-w-md rounded-2xl border bg-card p-6 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
              <MonitorIcon className="size-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">Fullscreen required</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              This exam locks in fullscreen. You exited — click below to re-enter. Your timer keeps running and this counts toward violations.
            </p>
            <Button className="shadow-glow mt-5 h-11 w-full" onClick={() => void reenterFullscreen()}>
              <MonitorIcon data-icon="inline-start" /> Re-enter fullscreen
            </Button>
            <p className="text-muted-foreground mt-3 text-xs">If browser blocks it, allow fullscreen in site settings.</p>
          </motion.div>
        </div>
      )}

      {/* Question area — premium card layout */}
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? "q"}
            // The blur/slide is a flourish; a reduced-motion request has to reach
            // it in JS, because the CSS media query in `globals.css` cannot touch
            // an animation motion/react drives frame by frame.
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 18, filter: "blur(4px)" }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18, filter: "blur(4px)" }}
            transition={{ duration: reduceMotion ? 0.12 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">Q {currentIndex + 1} / {questions.length}</Badge>
                <Badge variant="outline" className="tabular-nums">{current?.points} {current?.points === 1 ? "mark" : "marks"}</Badge>
                {!effectivePolicy.allowSkipping && !hasAnswer && (
                  <Badge variant="destructive" className="gap-1"><AlertTriangleIcon className="size-3" /> Answer required</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => current && toggleFlag(current.id)}
                aria-pressed={isFlagged}
                className="gap-1.5"
              >
                <FlagIcon data-icon="inline-start" className={isFlagged ? "fill-amber-500 text-amber-500" : ""} />
                {isFlagged ? "Flagged" : "Flag"}
              </Button>
            </div>

            {current && (
              <QuestionView
                question={current}
                value={answerValue}
                onChange={(v) => setAnswer(current.id, v)}
              />
            )}

            {/* Inline skip hint */}
            {!effectivePolicy.allowSkipping && !hasAnswer && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                You must answer before you can continue — skipping is disabled for this exam.
              </p>
            )}
            {effectivePolicy.allowSkipping && !hasAnswer && !isLast && (
              <p className="text-muted-foreground text-xs">You can skip — unanswered questions score zero. You still cannot go back.</p>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer nav — policy-aware */}
      <footer className="glass sticky bottom-0 z-30 border-t">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {effectivePolicy.preventBacktrack ? (
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex gap-1.5 border-muted bg-muted/50 text-muted-foreground">
              <LockIcon className="size-3" /> Linear — no backtracking
            </Badge>
          ) : (
            <Button variant="outline" className="shrink-0" onClick={handlePrevious} disabled={currentIndex === 0}>
              <ChevronLeftIcon data-icon="inline-start" /> Previous
            </Button>
          )}

          <QuestionStrip
            allowJump={!effectivePolicy.preventBacktrack}
            allowForward={effectivePolicy.allowSkipping}
            onJump={jumpTo}
          />

          <Button className="shadow-glow min-w-[124px] shrink-0" onClick={handleNext} disabled={!canGoNext}>
            {isLast ? (
              <>
                <SendIcon data-icon="inline-start" /> Submit exam
              </>
            ) : (
              <>
                Next <ChevronRightIcon data-icon="inline-end" />
              </>
            )}
          </Button>
        </div>

        {/* Mobile: show Previous only when allowed */}
        {!effectivePolicy.preventBacktrack && currentIndex > 0 && (
          <div className="flex justify-start px-4 pb-3 sm:hidden">
            <Button variant="ghost" size="sm" onClick={handlePrevious}>
              <ChevronLeftIcon data-icon="inline-start" /> Previous
            </Button>
          </div>
        )}
      </footer>

      {/* Warning modal */}
      <AlertDialog open={!!warning} onOpenChange={(o) => !o && setWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlertIcon className="text-destructive size-5" />
              Warning {warning?.count ?? 1} of 2 — suspicious activity detected
            </AlertDialogTitle>
            <AlertDialogDescription>
              Detected: {warning?.reason}. Stay in fullscreen and keep working. One more violation will submit your exam automatically and lock it for teacher review.
              {effectivePolicy.preventBacktrack && " You cannot return to previous questions."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction render={<Button />}>I understand</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Submit confirmation modal */}
      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <SendIcon className="size-5" />
              Ready to submit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Here is where the paper stands.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Outside the description on purpose — it renders a `<p>`, and a list
              nested in a paragraph is closed by the parser before it starts. */}
          <SubmitReview
            showOutstanding={effectivePolicy.allowReviewBeforeSubmit}
            allowJump={effectivePolicy.allowReviewBeforeSubmit && !effectivePolicy.preventBacktrack}
            allowForward={effectivePolicy.allowSkipping}
            onJump={(index) => {
              setConfirmSubmit(false);
              jumpTo(index);
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" />}>
              {effectivePolicy.allowReviewBeforeSubmit && !effectivePolicy.preventBacktrack
                ? "Keep working"
                : "Go back"}
            </AlertDialogCancel>
            <AlertDialogAction render={<Button />} onClick={() => { setConfirmSubmit(false); void doSubmit(false); }}>
              Submit exam
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {phase === "submitting" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-md">
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="shadow-lifted w-full max-w-md overflow-hidden rounded-2xl border bg-card">
            <div className="bg-brand p-5 text-primary-foreground">
              <p className="flex items-center gap-2 text-sm font-semibold"><SparklesIcon className="size-4" /> Submitting your exam</p>
              <p className="mt-1 text-xs opacity-80">
                {recordingEnabled
                  ? "Please keep this tab open — we’re securing your answers and recordings."
                  : "Please keep this tab open — we’re securing your answers."}
              </p>
            </div>
            <div className="flex flex-col gap-4 p-5">
              {/* Stage 1 */}
              <div className="flex gap-3">
                <span className={`grid size-8 place-items-center rounded-full border text-xs font-bold ${submitStage === "answers" ? "border-primary bg-primary text-primary-foreground animate-pulse" : "border-success bg-success text-white"}`}>
                  {submitStage === "answers" ? <Loader2Icon className="size-4 animate-spin" /> : <CheckCircle2Icon className="size-4" />}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">Securing answers</p>
                  <p className="text-muted-foreground text-xs">{submitStage === "answers" ? "Uploading to server — deadline critical…" : "Answers secured ✓"}</p>
                  {submitStage === "answers" && <div className="bg-shimmer mt-2 h-1.5 rounded-full bg-muted" />}
                </div>
              </div>
              {/* Stage 2 — conditional on recording config */}
              {recordingEnabled ? (
                <div className="flex gap-3">
                  <span
                    className={`grid size-8 place-items-center rounded-full border text-xs font-bold ${submitStage === "recordings" ? "border-primary bg-primary text-primary-foreground" : submitStage === "answers" ? "border-border bg-muted text-muted-foreground" : "border-success bg-success text-white"}`}
                  >
                    {submitStage === "recordings" ? <Loader2Icon className="size-4 animate-spin" /> : submitStage === "finalizing" ? <CheckCircle2Icon className="size-4" /> : "2"}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Uploading recordings</p>
                    <div className="mt-3 grid gap-3">
                      {[
                        ...(effectivePolicy.enableCameraRecording
                          ? [{ label: "Camera", value: uploadProgress.camera, icon: CameraIcon, hint: "camera" } as const]
                          : []),
                        ...(effectivePolicy.enableScreenRecording
                          ? [{ label: "Screen", value: uploadProgress.screen, icon: MonitorIcon, hint: "screen" } as const]
                          : []),
                      ].map((item) => {
                        const Icon = item.icon;
                        const done = item.value >= 100;
                        const active = submitStage === "recordings" && !done;
                        return (
                          <div
                            key={item.label}
                            className={`overflow-hidden rounded-xl border transition-all ${done ? "border-emerald-500/20 bg-emerald-500/5" : active ? "border-primary/20 bg-primary/5 shadow-glow" : "border-border bg-muted/20"}`}
                          >
                            <div className="flex items-center gap-3 px-3 py-2.5">
                              <span
                                className={`grid size-8 place-items-center rounded-lg border shadow-sm transition-colors ${done ? "bg-emerald-500 border-emerald-500 text-white" : active ? "bg-brand border-primary text-primary-foreground shadow-glow" : "bg-card border-border text-muted-foreground"}`}
                              >
                                {done ? <CheckCircle2Icon className="size-4" /> : <Icon className={`size-4 ${active ? "animate-pulse" : ""}`} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 text-xs font-semibold">
                                  {item.label}
                                  {done ? <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> : active ? <span className="size-1.5 rounded-full bg-primary animate-pulse" /> : null}
                                  <span className="text-muted-foreground font-normal truncate">
                                    · {item.hint}-{item.value < 100 ? "uploading" : "done"}
                                  </span>
                                </p>
                                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                                  <motion.div
                                    className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-brand shadow-glow"} ${active ? "bg-shimmer" : ""}`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${item.value}%` }}
                                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                  />
                                </div>
                              </div>
                              <Badge
                                variant={done ? "secondary" : "outline"}
                                className={`tabular-nums text-xs ${done ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" : active ? "bg-primary/10 text-primary border-primary/20" : ""}`}
                              >
                                {item.value}%
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 rounded-xl border border-dashed bg-muted/20 p-3">
                  <span className="grid size-8 place-items-center rounded-full border bg-card text-muted-foreground">
                    <VideoIcon className="size-4" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Recording disabled</p>
                    <p className="text-muted-foreground text-xs">This exam does not save camera or screen video. Snapshots for proctoring remain active but no video will be uploaded.</p>
                  </div>
                </div>
              )}
              {/* Stage 3 */}
              <div className="flex gap-3">
                <span className={`grid size-8 place-items-center rounded-full border text-xs font-bold ${submitStage === "finalizing" ? "border-primary bg-primary text-primary-foreground animate-pulse" : "border-border bg-muted text-muted-foreground"}`}>
                  {submitStage === "finalizing" ? <Loader2Icon className="size-4 animate-spin" /> : "3"}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium">Finalizing</p>
                  <p className="text-muted-foreground text-xs">{submitStage === "finalizing" ? "Almost there — preparing your result…" : "Waiting…"}</p>
                </div>
              </div>
              <p className="rounded-xl border bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">Don’t close or refresh — you’ll be redirected to results.</p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
