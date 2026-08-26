"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ref, uploadBytes } from "firebase/storage";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FlagIcon,
  Loader2Icon,
  SendIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { storageClient } from "@/lib/firebase/client";
import { Markdown } from "@/components/markdown";
import { useExamSession } from "@/stores/exam-session";
import { useProctoring } from "@/components/features/exam/proctoring";
import { ExamOnboarding } from "@/components/features/exam/exam-onboarding";
import type { StartedExam } from "@/lib/schemas/attempt";
import type { SafeQuestion } from "@/lib/schemas/attempt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function TimerRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const pct = Math.max(0, Math.min(1, remainingMs / totalMs));
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const danger = remainingMs < 5 * 60_000;

  return (
    <div className="relative grid size-14 place-items-center">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
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
      <span className={`text-xs font-semibold tabular-nums ${danger ? "text-destructive" : ""}`}>
        {mm}:{ss}
      </span>
    </div>
  );
}

/* ── Question inputs ───────────────────────────────────────── */

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

  return (
    <div className="flex flex-col gap-5">
      <div className="text-pretty text-base leading-relaxed sm:text-lg">
        <Markdown>{question.prompt}</Markdown>
      </div>

      {question.type === "multiple_choice" && question.options && (
        <div className="grid gap-2.5">
          {question.options.map((opt, i) => (
            <label
              key={i}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                value === i
                  ? "border-primary bg-accent/50 shadow-glow"
                  : "hover:bg-accent/30"
              }`}
            >
              <input
                type="radio"
                name={question.id}
                className="accent-primary mt-1"
                checked={value === i}
                onChange={() => onChange(i)}
              />
              <span className="flex-1 text-sm sm:text-base">
                <span className="text-muted-foreground mr-2 font-semibold">
                  {String.fromCharCode(65 + i)}.
                </span>
                <Markdown className="inline">{opt}</Markdown>
              </span>
            </label>
          ))}
        </div>
      )}

      {question.type === "true_false" && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "True", val: true },
            { label: "False", val: false },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.val)}
              className={`rounded-xl border px-6 py-4 text-base font-medium transition-all ${
                value === opt.val
                  ? "border-primary bg-accent/50 shadow-glow"
                  : "hover:bg-accent/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {question.type === "fill_in_the_blank" && (
        <div className="grid gap-2.5">
          {Array.from({ length: blanks }).map((_, i) => (
            <Input
              key={i}
              placeholder={`Blank ${i + 1}`}
              className="h-11"
              value={Array.isArray(value) ? (value[i] ?? "") : ""}
              onChange={(e) => {
                const arr = Array.isArray(value) ? [...value] : Array(blanks).fill("");
                arr[i] = e.target.value;
                onChange(arr);
              }}
            />
          ))}
          {blanks === 0 && (
            <Input
              className="h-11"
              placeholder="Your answer"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </div>
      )}

      {question.type === "short_answer" && (
        <Input
          className="h-11"
          placeholder="Your answer"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {question.type === "essay" && (
        <Textarea
          rows={8}
          placeholder="Write your answer here. You can use multiple paragraphs…"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {question.type === "matching" && question.pairs && (
        <div className="grid gap-3">
          {question.pairs.map((pair, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr] items-center gap-3">
              <div className="rounded-lg border p-3 text-sm">
                <Markdown>{pair.left}</Markdown>
              </div>
              <Input
                placeholder="Matched item"
                value={Array.isArray(value) ? (value[i] ?? "") : ""}
                onChange={(e) => {
                  const arr = Array.isArray(value)
                    ? [...value]
                    : Array(question.pairs?.length ?? 0).fill("");
                  arr[i] = e.target.value;
                  onChange(arr);
                }}
              />
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            Type the matching item for each prompt, exactly as shown in the
            question bank.
          </p>
        </div>
      )}

      {question.hint && (
        <details className="group">
          <summary className="text-muted-foreground cursor-pointer text-sm hover:text-foreground">
            💡 Show hint
          </summary>
          <div className="bg-muted mt-2 rounded-lg p-3 text-sm">
            <Markdown>{question.hint}</Markdown>
          </div>
        </details>
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

export function ExamRunner({
  attemptId,
  examTitle,
  durationMinutes,
  questionCount,
}: {
  attemptId: string;
  examTitle: string;
  durationMinutes: number;
  questionCount: number;
}) {
  const router = useRouter();
  const session = useExamSession();
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
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const submittedRef = useRef(false);
  const clockRef = useRef<Worker | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const startMsRef = useRef<number>(0);
  const doSubmitRef = useRef<(auto: boolean) => Promise<void>>(null!);

  const rig = useProctoring(attemptId, {
    onWarning: (count, violation) =>
      setWarning({ count, reason: violation.reason ?? violation.type.replace(/_/g, " ") }),
    onTerminate: () => {
      setPhase("terminated");
      void doSubmitRef.current?.(true);
    },
  });

  // Camera PIP preview.
  useEffect(() => {
    if (cameraPreviewRef.current && rig.cameraStream) {
      cameraPreviewRef.current.srcObject = rig.cameraStream;
      void cameraPreviewRef.current.play().catch(() => undefined);
    }
  }, [rig.cameraStream, phase]);

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
      session.hydrate({
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
      await document.documentElement.requestFullscreen?.().catch(() => undefined);
      setPhase("exam");

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
  }, [attemptId, session.hydrate, rig.beginExamCapture]);

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
      let cameraPath: string | null = null;
      let screenPath: string | null = null;
      try {
        if (cameraBlob) {
          cameraPath = `recordings/${attemptId}/camera.webm`;
          await uploadBytes(ref(storage, cameraPath), cameraBlob, {
            contentType: "video/webm",
          });
        }
        if (screenBlob) {
          screenPath = `recordings/${attemptId}/screen.webm`;
          await uploadBytes(ref(storage, screenPath), screenBlob, {
            contentType: "video/webm",
          });
        }
      } catch (err) {
        console.warn("[exam] recording upload failed", err);
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
    async (auto: boolean): Promise<boolean> => {
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
      return res.ok;
    },
    [attemptId],
  );

  const doSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setPhase("submitting");
      clockRef.current?.postMessage({ type: "stop" });

      try {
        // 1) Answers first — this is what the server deadline judges.
        const ok = await submitAnswers(auto);
        if (!ok) throw new Error("rejected");

        try {
          sessionStorage.removeItem(draftKey(attemptId));
        } catch {}

        if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
        toast.success("Submitted!", {
          description: "Your recordings are uploading in the background.",
        });
        router.replace(`/student/results/${attemptId}`);
      } catch {
        // Recoverable: unblock and let the student retry (or the worker's
        // expiry tick re-fire). Keep the phase on exam so the UI is usable.
        submittedRef.current = false;
        setPhase("exam");
        toast.error("Submission failed — check your connection and try again.");
      }

      // 2) Recordings after — failures here must not block or mislead:
      //    stop capture first, then upload whatever we got.
      void (async () => {
        const { cameraBlob, screenBlob } = await rig.stopEverything();
        await uploadRecordings(cameraBlob, screenBlob);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId, rig.stopEverything, uploadRecordings, submitAnswers, router],
  );

  // Keep the submit indirection fresh for proctoring/worker callbacks.
  useEffect(() => {
    doSubmitRef.current = doSubmit;
  });

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
        onGrantPermissions={async () => {
          const ok = await rig.requestPermissions();
          setPermissionsGranted(ok);
        }}
        onStart={() => void startExam()}
        starting={starting}
        error={startError}
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

  const questions = session.questions;
  const current = questions[session.current];
  const answered = session.answeredCount();
  const progressPct = questions.length ? (answered / questions.length) * 100 : 0;

  return (
    <div className="bg-background flex min-h-dvh flex-col select-none">
      {/* Header */}
      <header className="glass sticky top-0 z-40 flex h-16 items-center gap-3 px-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{session.examTitle}</p>
          <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="bg-brand h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {answered}/{questions.length} answered
        </Badge>
        <TimerRing
          remainingMs={remainingMs}
          totalMs={(meta?.durationMinutes ?? 0) * 60_000}
        />
        {/* Camera PIP */}
        <div className="border-primary/40 relative ml-1 hidden size-14 overflow-hidden rounded-lg border-2 sm:block">
          <video
            ref={cameraPreviewRef}
            muted
            playsInline
            className="size-full object-cover"
          />
        </div>
      </header>

      {/* Question area */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? "q"}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-5"
          >
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline">
                Question {session.current + 1} of {questions.length} · {current?.points}{" "}
                {current?.points === 1 ? "mark" : "marks"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => current && session.toggleFlag(current.id)}
                aria-pressed={current ? session.flagged.has(current.id) : false}
              >
                <FlagIcon data-icon="inline-start" />
                {current && session.flagged.has(current.id) ? "Flagged" : "Flag"}
              </Button>
            </div>
            {current && (
              <QuestionView
                question={current}
                value={session.answers[current.id]}
                onChange={(v) => current && session.setAnswer(current.id, v)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer nav */}
      <footer className="glass sticky bottom-0 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Button
          variant="outline"
          onClick={() => session.setCurrent(session.current - 1)}
          disabled={session.current === 0}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Previous
        </Button>

        {/* Mobile question jumper (dots are md+ only) */}
        <div className="flex items-center gap-2 md:hidden">
          <select
            aria-label="Go to question"
            value={session.current}
            onChange={(e) => session.setCurrent(Number(e.target.value))}
            className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
          >
            {questions.map((q, i) => (
              <option key={q.id} value={i}>
                Q{i + 1}{session.flagged.has(q.id) ? " ⚑" : q.id in session.answers ? " ✓" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden gap-1.5 md:flex">
          {questions.map((q, i) => {
            const answeredQ = q.id in session.answers;
            const flagged = session.flagged.has(q.id);
            return (
              <button
                key={q.id}
                onClick={() => session.setCurrent(i)}
                aria-label={`Go to question ${i + 1}`}
                className={`size-7 rounded-md border text-xs font-medium tabular-nums transition-all ${
                  i === session.current
                    ? "border-primary bg-primary text-primary-foreground shadow-glow"
                    : flagged
                      ? "border-amber-500/60 bg-amber-500/15"
                      : answeredQ
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {session.current === questions.length - 1 ? (
          <Button className="shadow-glow" onClick={() => setConfirmSubmit(true)}>
            <SendIcon data-icon="inline-start" />
            Submit exam
          </Button>
        ) : (
          <Button onClick={() => session.setCurrent(session.current + 1)}>
            Next
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
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
              Detected: {warning?.reason}. Stay in fullscreen and keep working.
              One more violation will submit your exam automatically and lock
              it for teacher review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction render={<Button />}>I understand</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Submit confirm */}
      <AlertDialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
            <AlertDialogDescription>
              You answered {answered} of {questions.length} questions
              {answered < questions.length ? " — unanswered questions score zero." : "."}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" />}>Keep working</AlertDialogCancel>
            <AlertDialogAction
              render={<Button className="shadow-glow" />}
              onClick={() => void doSubmit(false)}
            >
              <SendIcon data-icon="inline-start" />
              Submit now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {phase === "submitting" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur">
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2Icon className="text-primary size-8 animate-spin" />
            <p className="font-medium">Submitting your exam…</p>
            <p className="text-muted-foreground text-sm">
              Finalizing your answers — this only takes a moment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
