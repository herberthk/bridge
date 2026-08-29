"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
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
import { useExamSession } from "@/stores/exam-session";
import { useProctoring } from "@/components/features/exam/proctoring";
import { ExamOnboarding } from "@/components/features/exam/exam-onboarding";
import { QuestionVisualView } from "@/components/features/exam/question-visual";
import type { ExamSessionPolicy, StartedExam } from "@/lib/schemas/attempt";
import type { SafeQuestion } from "@/lib/schemas/attempt";
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

/* ── Question inputs — premium, modern, aligned ───────────── */

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
    <div className="text-pretty text-[15px] leading-7 sm:text-[17px] sm:leading-8">
      <span className="inline flex-wrap items-baseline gap-x-2 gap-y-2">
        {parts.map((segment, idx) => (
          <span key={idx} className="inline">
            {segment && <Markdown className="inline [&_p]:inline [&_p]:m-0">{segment}</Markdown>}
            {idx < parts.length - 1 && (
              <span className="mx-1 inline-flex align-baseline">
                <Input
                  placeholder={`Blank ${idx + 1}`}
                  className="h-8 w-[14ch] min-w-[10ch] rounded-full border-primary/20 bg-card px-3 text-sm shadow-card focus-visible:ring-2 sm:h-9 sm:w-[18ch]"
                  value={Array.isArray(value) ? (value[idx] ?? "") : ""}
                  onChange={(e) => {
                    const arr = Array.isArray(value) ? [...value] : Array(blanks).fill("");
                    arr[idx] = e.target.value;
                    onChange(arr);
                  }}
                  aria-label={`Blank ${idx + 1}`}
                />
              </span>
            )}
          </span>
        ))}
      </span>
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
            {question.type === "multiple_choice"
              ? "Multiple choice"
              : question.type === "true_false"
                ? "True / False"
                : question.type === "fill_in_the_blank"
                  ? "Fill in the blank"
                  : question.type === "short_answer"
                    ? "Short answer"
                    : question.type === "essay"
                      ? "Essay"
                      : question.type === "matching"
                        ? "Matching"
                        : question.type}
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
            <div className="text-pretty text-[15px] leading-7 sm:text-[17px] sm:leading-8">
              <Markdown>{question.prompt}</Markdown>
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
        <div className="grid gap-3 sm:grid-cols-2">
          {question.options.map((opt, i) => {
            const selected = value === i;
            return (
              <label
                key={i}
                className={`group relative flex cursor-pointer items-start gap-3 rounded-2xl border p-4 pr-3 text-left transition-all duration-200 will-change-transform hover:shadow-lifted ${
                  selected
                    ? "border-primary bg-primary/6 shadow-glow"
                    : "bg-card hover:bg-accent/40"
                }`}
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors ${
                    selected ? "border-primary bg-primary text-primary-foreground shadow-glow" : "border-border bg-muted text-muted-foreground group-hover:border-primary/30"
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1 pt-1 text-sm leading-relaxed sm:text-[14px]">
                  <Markdown className="inline [&_p]:inline">{opt}</Markdown>
                </span>
                <input type="radio" name={question.id} className="sr-only" checked={selected} onChange={() => onChange(i)} />
                {selected && <span className="absolute inset-0 rounded-2xl border border-primary/20 pointer-events-none" aria-hidden />}
              </label>
            );
          })}
        </div>
      )}

      {question.type === "true_false" && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "True", val: true },
            { label: "False", val: false },
          ].map((opt) => {
            const selected = value === opt.val;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => onChange(opt.val)}
                className={`group relative rounded-2xl border px-6 py-6 text-base font-semibold transition-all duration-200 will-change-transform hover:shadow-lifted ${
                  selected ? "border-primary bg-primary text-primary-foreground shadow-glow" : "bg-card hover:bg-accent/40"
                }`}
              >
                <span className={`mx-auto grid size-9 place-items-center rounded-full border text-sm font-bold ${selected ? "border-white/20 bg-white/15 text-white" : "border-border bg-muted text-muted-foreground"}`}>
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
  const session = useExamSession();
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
  const questions = session.questions;
  const current = questions[session.current];
  const answered = session.answeredCount();
  const progressPct = questions.length ? (answered / questions.length) * 100 : 0;
  const answerValue = current ? session.answers[current.id] : undefined;
  const hasAnswer = current ? (answerValue !== undefined && answerValue !== null && answerValue !== "") : false;
  const canGoNext = effectivePolicy.allowSkipping || hasAnswer;
  const isLast = session.current === questions.length - 1;

  const reenterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } catch {}
  }, []);

  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const handleNext = useCallback(() => {
    const cur = session.questions[session.current];
    const answerNow = cur ? useExamSession.getState().answers[cur.id] : undefined;
    const answeredNow = answerNow !== undefined && answerNow !== null && answerNow !== "";
    const canProceed = effectivePolicy.allowSkipping || answeredNow;
    if (!canProceed) {
      toast.error("Answer required before continuing.", { description: "This exam does not allow skipping." });
      return;
    }
    const last = session.current === session.questions.length - 1;
    if (last) {
      setConfirmSubmit(true);
    } else {
      session.setCurrent(session.current + 1);
    }
  }, [effectivePolicy.allowSkipping, session]);

  const handlePrevious = useCallback(() => {
    if (effectivePolicy.preventBacktrack) return;
    session.setCurrent(session.current - 1);
  }, [effectivePolicy.preventBacktrack, session]);

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
              <p className="truncate text-sm font-semibold tracking-tight">{session.examTitle}</p>
              <p className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                Question {session.current + 1} of {questions.length} · {answered}/{questions.length} answered
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
            initial={{ opacity: 0, x: 18, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -18, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="tabular-nums">Q {session.current + 1} / {questions.length}</Badge>
                <Badge variant="outline" className="tabular-nums">{current?.points} {current?.points === 1 ? "mark" : "marks"}</Badge>
                {!effectivePolicy.allowSkipping && !hasAnswer && (
                  <Badge variant="destructive" className="gap-1"><AlertTriangleIcon className="size-3" /> Answer required</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => current && session.toggleFlag(current.id)}
                aria-pressed={current ? session.flagged.has(current.id) : false}
                className="gap-1.5"
              >
                <FlagIcon data-icon="inline-start" className={current && session.flagged.has(current.id) ? "fill-amber-500 text-amber-500" : ""} />
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
            <Badge variant="outline" className="hidden sm:inline-flex gap-1.5 border-muted bg-muted/50 text-muted-foreground">
              <LockIcon className="size-3" /> Linear — no backtracking
            </Badge>
          ) : (
            <Button variant="outline" onClick={handlePrevious} disabled={session.current === 0}>
              <ChevronLeftIcon data-icon="inline-start" /> Previous
            </Button>
          )}

          {/* Progress dots — interactive only when backtrack allowed, else read-only */}
          <div className="flex items-center gap-1.5">
            {questions.map((q, i) => {
              const ansVal = session.answers[q.id];
              const answeredQ = ansVal !== undefined && ansVal !== null && ansVal !== "";
              const flagged = session.flagged.has(q.id);
              const isPast = i < session.current;
              const clickable = !effectivePolicy.preventBacktrack && !isPast;
              return (
                <button
                  key={q.id}
                  disabled={!clickable || i > session.current}
                  onClick={() => clickable && session.setCurrent(i)}
                  aria-label={`Go to question ${i + 1}`}
                  className={`size-2.5 rounded-full transition-all sm:size-3 ${
                    i === session.current
                      ? "bg-primary shadow-glow scale-125"
                      : flagged
                        ? "bg-amber-500"
                        : answeredQ
                          ? "bg-success"
                          : "bg-muted-foreground/25"
                  } ${clickable ? "cursor-pointer hover:scale-110" : "cursor-default"}`}
                />
              );
            })}
            <span className="ml-2 hidden text-xs tabular-nums text-muted-foreground sm:inline">
              {session.current + 1} / {questions.length}
            </span>
          </div>

          <Button className="shadow-glow min-w-[124px]" onClick={handleNext} disabled={!canGoNext}>
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
        {!effectivePolicy.preventBacktrack && session.current > 0 && (
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
              You are about to submit your exam. This action cannot be undone. Make sure you have answered all the questions you wanted to complete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" />}>Go back</AlertDialogCancel>
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
