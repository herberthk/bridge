"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import type { FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  BookOpenIcon,
  CameraIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  GraduationCapIcon,
  LayersIcon,
  Loader2Icon,
  LockIcon,
  MonitorIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagIcon,
  TargetIcon,
  UploadCloudIcon,
  VideoIcon,
  XIcon,
  ZapIcon,
  EyeIcon,
  ClockIcon,
  CalendarClockIcon,
  FileQuestionIcon,
  ClipboardCheckIcon,
} from "lucide-react";

import { examParamsSchema, type ExamParamsInput } from "@/lib/schemas/exam";
import {
  COUNTRY_CURRICULA,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  EXAM_DURATION_MAX,
  EXAM_DURATION_MIN,
  EXAM_QUESTIONS_MAX,
  EXAM_QUESTIONS_MIN,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  SECONDARY_SUBJECTS_BY_SUB_LEVEL,
  SUB_LEVEL_LABELS,
  SUBJECT_LABELS,
  SUBJECT_SUBSIDIARIES,
  SUBSIDIARY_LABELS,
  type Subject,
} from "@/lib/constants";
import { classLevelOptions } from "@/lib/schemas/users";
import {
  estimateGenerationTokens,
  formatTokens,
  formatUgx,
  formatUsd,
  reserveForGeneration,
  tokensToUsd,
  usdToUgx,
} from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDisplay,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Markdown } from "@/components/markdown";
import { QuestionVisualView } from "@/components/features/exam/question-visual";
import type { ClassDoc, QuestionVisual } from "@/types/firestore";

interface UploadedDoc {
  documentId: string;
  name: string;
  parseStatus: "pending" | "parsed" | "failed";
  uploading: boolean;
  progress: number; // 0-100 beautiful indicator
  sizeLabel: string;
}

interface PreviewQuestion {
  id: string;
  type: string;
  prompt: string;
  points: number;
  options?: string[] | null;
  /**
   * Present on the wire and previously dropped here, which made the preview
   * silently unlike the paper: a chart or table question showed only its prompt,
   * so the one screen a teacher checks before assigning could not surface a
   * malformed visual.
   */
  visual?: QuestionVisual | null;
}

import type { z } from "zod";

/**
 * Memoized preview row.
 *
 * Perf: the wizard parent re-renders on every form keystroke (`useWatch`),
 * but preview props are state-stable — `memo` skips the re-render and the
 * KaTeX re-run inside each `Markdown`. `content-visibility: auto` lets the
 * browser skip layout for offscreen rows until scrolled to.
 */
const PreviewQuestionRow = memo(function PreviewQuestionRow({
  q,
  index,
}: {
  q: PreviewQuestion;
  index: number;
}) {
  return (
    <li className="flex gap-3.5 p-4 transition-colors hover:bg-muted/20 sm:gap-4 sm:p-5 [content-visibility:auto] [contain-intrinsic-size:auto_140px]">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[13px] font-bold tabular-nums text-primary"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[11px] tabular-nums">
            {q.points} {q.points === 1 ? "mark" : "marks"}
          </Badge>
          <Badge variant="outline" className="text-[11px] capitalize">
            {q.type.replace(/_/g, " ")}
          </Badge>
          {q.visual ? (
            <Badge variant="outline" className="text-[11px]">
              Visual
            </Badge>
          ) : null}
        </div>
        {/* `prose-bridge`, not `prose prose-sm dark:prose-invert`:
            `@tailwindcss/typography` is not installed, so every `prose-*`
            class here was inert and the preview rendered with none of the
            spacing the exam runner has. */}
        <div className="mt-2 text-sm">
          <Markdown className="prose-bridge">{q.prompt}</Markdown>
        </div>
        {q.visual ? <QuestionVisualView visual={q.visual} /> : null}
        {q.options && q.options.length > 0 && (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {q.options.map((opt, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-[13px] leading-relaxed"
              >
                <span className="mt-px grid size-5 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                  {String.fromCharCode(65 + i)}
                </span>
                {/* No `line-clamp-2` and no `<span>` wrapper: the clamp cut
                    rendered KaTeX mid-formula, and `Markdown` renders a
                    `<div>`, which a `<span>` may not hold. */}
                <div className="min-w-0 flex-1">
                  <Markdown className="prose-bridge">{opt}</Markdown>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
});

/** Form shape before zod applies defaults. */
type FormValues = z.input<typeof examParamsSchema>;

// ── Wizard steps ──────────────────────────────────────────────
const STEPS = [
  { id: "curriculum", label: "Curriculum", icon: BookOpenIcon, desc: "Level & topic" },
  { id: "format", label: "Format", icon: LayersIcon, desc: "Types & timing" },
  { id: "rules", label: "Rules & Source", icon: ShieldCheckIcon, desc: "Policy & docs" },
  { id: "review", label: "Review", icon: ClipboardCheckIcon, desc: "Summary & generate" },
] as const;

/**
 * Which fields live on which wizard step — indexed by step, parallel to STEPS.
 * Single source of truth for both the "next" gate and the invalid-submit
 * handler, so a validation error can always be traced back to a visible step.
 */
const STEP_FIELDS: readonly (readonly (keyof FormValues)[])[] = [
  ["level", "secondarySubLevel", "subject", "classLevel", "topic", "subsidiary"],
  [
    "questionTypes",
    "difficulty",
    "questionCount",
    "durationMinutes",
    "includeHints",
    "includeExplanations",
    "includeWorkedExamples",
    "instructions",
  ],
  [
    "preventBacktrack",
    "allowReviewBeforeSubmit",
    "allowSkipping",
    "requireFullscreen",
    "enableCameraRecording",
    "enableScreenRecording",
  ],
  [], // Review step has no form validation fields
];

/**
 * Client-side ceiling on a generation request. Sits just above the route's
 * `maxDuration = 180`, so anything past it is a dead socket — abort with a useful
 * message instead of leaving the wizard spinning forever.
 *
 * Has to stay *above* `maxDuration`, not below it. At 125s against a 180s route
 * this aborted a 60-question exam the server was still generating — the wallet
 * already reserved, the exam about to be written, and the admin told it timed out.
 */
const GENERATION_TIMEOUT_MS = 185_000;

/**
 * Mirrors `generateExamSchema`'s `documentIds.max(10)`. Without a client cap the
 * 11th upload succeeds, costs storage and a parse, and then fails the whole
 * generation on a validation error the admin can't tie back to a file.
 */
const MAX_SOURCE_DOCS = 10;

const GEN_STAGES = [
  { label: "Parsing source documents", pct: 18, icon: FileTextIcon },
  { label: "Analyzing curriculum context", pct: 32, icon: BookOpenIcon },
  { label: "Drafting questions with Gemini", pct: 72, icon: SparklesIcon },
  { label: "Calibrating difficulty & marks", pct: 88, icon: TargetIcon },
  { label: "Finalizing & saving exam", pct: 100, icon: CheckCircle2Icon },
] as const;

// Premium trigger styles — shared across all dropdowns
const premiumTrigger =
  "h-11 rounded-xl border bg-card shadow-card hover:shadow-lifted hover:border-primary/20 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/20 data-[state=open]:shadow-glow transition-all duration-200 group";
const premiumContent = "rounded-2xl shadow-lifted border bg-popover/95 backdrop-blur-xl p-1.5";

/** `null` = show mode picker; otherwise the wizard runs in the chosen mode. */
type SourceMode = "pure_ai" | "document_grounded" | null;

export type ExamGeneratorClassScope = Pick<
  ClassDoc,
  "level" | "secondarySubLevel" | "classLevel" | "name"
> & { id: string };

export function ExamGenerator({ classScope }: { classScope: ExamGeneratorClassScope }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genPct, setGenPct] = useState(0);
  const [genStage, setGenStage] = useState(0);
  const [result, setResult] = useState<{
    examId: string;
    title: string;
    questions: number;
    tokensUsed: number;
    /** Pre-flight estimate at submit time — the form stays editable afterwards. */
    estimateTokens: number;
    /** Snapshot of what was actually submitted — the form stays editable. */
    subject: Subject;
    difficulty: keyof typeof DIFFICULTY_LABELS;
    durationMinutes: number;
  } | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<PreviewQuestion[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [step, setStep] = useState(0);
  // Deadline/expiry — optional; a class-scoped exam attaches to the class that
  // linked here (query param), so class dashboards can list its exams.
  const [deadline, setDeadline] = useState<string>("");
  // Captured once at mount — Date.now() is impure and can't run during render.
  const [mountedAtIso] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString());
  const [dir, setDir] = useState(1);
  const genTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voice-builder handoff only seeds `defaultValues`, which React Hook Form
  // reads once. Parsing on every render was wasted work; a lazy initializer
  // pins it to mount so a later URL change can't silently diverge from the
  // form the user is already editing.
  const [voice] = useState(() => readVoiceParams(searchParams));
  const [sourceMode, setSourceMode] = useState<SourceMode>(voice.mode);
  // Class context is required for school staff. The server component passes
  // the class it already authorized instead of trusting duplicate URL scope.
  const classIdParam = classScope.id;
  const classNameParam = classScope.name;
  // Arriving from a class dashboard pins level/sub-level/class: they seed the
  // form AND stay locked — the server rejects any mismatch anyway, so letting
  // them be edited would only set the user up to fail at generate time.
  const lockedScope = true;

  const scopedSubjects = (
    classScope.level === "primary"
      ? COUNTRY_CURRICULA.UG.primary
      : SECONDARY_SUBJECTS_BY_SUB_LEVEL[classScope.secondarySubLevel ?? "o_level"]
  ) as readonly Subject[];
  const scopedSubject = scopedSubjects.includes(voice.subject as Subject)
    ? (voice.subject as Subject)
    : (scopedSubjects.includes("mathematics") ? "mathematics" : scopedSubjects[0]!);

  const form = useForm<FormValues, unknown, ExamParamsInput>({
    resolver: zodResolver(examParamsSchema),
    defaultValues: {
      subject: scopedSubject,
      level: classScope.level,
      secondarySubLevel: classScope.secondarySubLevel,
      classLevel: classScope.classLevel,
      topic: voice.topic,
      subsidiary: scopedSubject === voice.subject ? voice.subsidiary : null,
      difficulty: voice.difficulty,
      durationMinutes: voice.durationMinutes,
      questionCount: voice.questionCount,
      questionTypes: voice.questionTypes,
      includeHints: true,
      includeExplanations: true,
      includeWorkedExamples: false,
      instructions: null,
      preventBacktrack: true,
      allowReviewBeforeSubmit: false,
      allowSkipping: true,
      requireFullscreen: true,
      enableCameraRecording: false,
      enableScreenRecording: false,
    },
  });

  // `useWatch` subscribes to individual fields. `form.watch()` re-renders on
  // every keystroke in the form and opts this component out of React Compiler
  // memoization entirely (react-hooks/incompatible-library).
  const control = form.control;
  const level = useWatch({ control, name: "level" });
  const subLevel = useWatch({ control, name: "secondarySubLevel" }) ?? "o_level";
  const subject = useWatch({ control, name: "subject" });
  const questionCount = useWatch({ control, name: "questionCount" });
  const durationMinutes = useWatch({ control, name: "durationMinutes" });
  const topic = useWatch({ control, name: "topic" });
  const difficulty = useWatch({ control, name: "difficulty" });
  const questionTypes = useWatch({ control, name: "questionTypes" });
  const classLevel = useWatch({ control, name: "classLevel" });
  const subsidiary = useWatch({ control, name: "subsidiary" });
  const includeHints = useWatch({ control, name: "includeHints" });
  const includeExplanations = useWatch({ control, name: "includeExplanations" });
  const includeWorkedExamples = useWatch({ control, name: "includeWorkedExamples" });
  const instructions = useWatch({ control, name: "instructions" });
  const preventBacktrack = useWatch({ control, name: "preventBacktrack" });
  const allowReviewBeforeSubmit = useWatch({ control, name: "allowReviewBeforeSubmit" });
  const allowSkipping = useWatch({ control, name: "allowSkipping" });
  const requireFullscreen = useWatch({ control, name: "requireFullscreen" });
  const enableCameraRecording = useWatch({ control, name: "enableCameraRecording" });
  const enableScreenRecording = useWatch({ control, name: "enableScreenRecording" });
  const subjects =
    level === "primary"
      ? COUNTRY_CURRICULA.UG.primary
      : SECONDARY_SUBJECTS_BY_SUB_LEVEL[subLevel];
  const needsSubsidiary = Boolean(
    SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES],
  );

  // Mirror the submit-time filter exactly: a document that failed to parse is
  // dropped from `documentIds`, so it must not inflate the quoted price either.
  const hasGroundingDoc = docs.some((d) => !d.uploading && d.parseStatus === "parsed");
  const estimate = useMemo(
    () => estimateGenerationTokens(questionCount, hasGroundingDoc),
    [questionCount, hasGroundingDoc],
  );
  /** What `assertCanAfford` will actually demand — quote it, don't surprise them with a 402. */
  const reserve = reserveForGeneration(estimate);

  /**
   * `generating` flips inside the submit callback, but `handleSubmit` awaits
   * validation first — a second click inside that window starts a second
   * request and bills a second generation. `isSubmitting` covers the gap.
   */
  const busy = generating || form.formState.isSubmitting;
  const uploadsPending = docs.some((d) => d.uploading);
  const docsRequired = sourceMode === "document_grounded";

  // Fetch preview questions after generation
  useEffect(() => {
    if (!result?.examId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/exams/${result.examId}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setPreviewQuestions(null);
            setPreviewFailed(true);
          }
          return;
        }
        const data = (await res.json()) as { exam?: { questions: PreviewQuestion[] } };
        if (!cancelled) {
          if (data.exam?.questions && Array.isArray(data.exam.questions)) {
            setPreviewQuestions(data.exam.questions.slice(0, 6));
            setPreviewFailed(false);
          } else {
            setPreviewQuestions(null);
            setPreviewFailed(true);
          }
        }
      } catch {
        if (!cancelled) {
          setPreviewQuestions(null);
          setPreviewFailed(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [result?.examId]);

  // ── Staged generation progress (client simulation, premium) ──
  useEffect(() => {
    if (!generating) {
      if (genTimerRef.current) clearInterval(genTimerRef.current);
      return;
    }
    // genPct/genStage are reset by `onSubmit` before `generating` flips, so this
    // effect only owns the interval.
    const started = Date.now();
    // Tracks how the server actually paces itself: five questions per chunk, six
    // chunks in flight, ~30s a wave. The old `22s + count × 260ms` capped at 40s,
    // so a 60-question exam parked the bar at 96% for the remaining minute and
    // read as stalled. Waves rather than a per-question rate, because chunks run
    // concurrently — 20 questions and 30 questions cost the same wall clock.
    const waves = Math.max(1, Math.ceil(Math.ceil(questionCount / 5) / 6));
    const durationMs = 12_000 + waves * 30_000;
    genTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const t = Math.min(elapsed / durationMs, 0.96);
      const eased = 1 - Math.pow(1 - t, 3);
      const target = Math.min(96 * eased, 96);
      // Both derived from `target`, so the state updater stays pure — calling
      // setGenStage from inside setGenPct fires twice under StrictMode.
      setGenPct((prev) => Math.max(prev, target));
      const stageIdx = GEN_STAGES.findIndex((s) => target < s.pct);
      setGenStage(stageIdx === -1 ? GEN_STAGES.length - 1 : Math.max(0, stageIdx));
    }, 120);
    return () => {
      if (genTimerRef.current) clearInterval(genTimerRef.current);
    };
  }, [generating, questionCount]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const uploadWithXhr = (file: File, onProgress: (pct: number) => void) =>
    new Promise<{ ok: true; documentId: string; parseStatus: "parsed" | "failed" } | { error: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.set("file", file);
      xhr.open("POST", "/api/documents");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText) as { ok?: boolean; documentId?: string; parseStatus?: string; error?: string };
          if (xhr.status >= 200 && xhr.status < 300 && data.ok) resolve(data as { ok: true; documentId: string; parseStatus: "parsed" | "failed" });
          else resolve({ error: (data as { error?: string })?.error ?? `Upload failed: ${xhr.statusText}` });
        } catch {
          resolve({ error: "Invalid server response" });
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(fd);
    });

  const onDrop = async (files: File[]) => {
    // `docs` is this render's list, which already includes any still-uploading
    // placeholders from an earlier drop — so room is accurate at drop time.
    // The batch is sliced up front because the loop's closure never sees the
    // appends it makes.
    const room = MAX_SOURCE_DOCS - docs.length;
    if (room <= 0) {
      toast.error(`You can attach at most ${MAX_SOURCE_DOCS} source documents.`);
      return;
    }
    const batch = files.slice(0, room);
    if (files.length > batch.length) {
      toast.warning(
        `Only ${batch.length} of ${files.length} files were added — the limit is ${MAX_SOURCE_DOCS} source documents.`,
      );
    }
    for (const file of batch) {
      const id = crypto.randomUUID();
      const sizeLabel = formatBytes(file.size);
      setDocs((prev) => [
        ...prev,
        { documentId: id, name: file.name, parseStatus: "pending", uploading: true, progress: 0, sizeLabel },
      ]);
      try {
        const data = await uploadWithXhr(file, (pct) => {
          setDocs((prev) => prev.map((d) => (d.documentId === id ? { ...d, progress: pct } : d)));
        });
        // Ensure bar hits 100 before switching to parsed
        setDocs((prev) => prev.map((d) => (d.documentId === id ? { ...d, progress: 100 } : d)));
        await new Promise((r) => setTimeout(r, 180));
        if ("error" in data) {
          toast.error(data.error);
          setDocs((prev) => prev.filter((d) => d.documentId !== id));
          continue;
        }
        setDocs((prev) =>
          prev.map((d) =>
            d.documentId === id
              ? { ...d, documentId: data.documentId, parseStatus: data.parseStatus, uploading: false, progress: 100 }
              : d,
          ),
        );
        if (data.parseStatus === "failed") {
          toast.warning(`Couldn't read text from ${file.name} — it will be skipped as source material.`);
        } else {
          toast.success(`${file.name} ready — grounded generation enabled.`);
        }
      } catch {
        toast.error(`Upload failed: ${file.name}`);
        setDocs((prev) => prev.filter((d) => d.documentId !== id));
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    // Without this, `accept`/`maxSize` rejections are dropped silently and the
    // file just never appears — indistinguishable from a broken drop target.
    onDropRejected: (rejections) => {
      for (const rejection of rejections) {
        const code = rejection.errors[0]?.code;
        const reason =
          code === "file-too-large"
            ? "it's larger than 10 MB"
            : code === "file-invalid-type"
              ? "only PDF, scanned images (JPG, PNG, WEBP), DOCX, and TXT are supported"
              : (rejection.errors[0]?.message ?? "it was rejected");
        toast.error(`${rejection.file.name} was skipped — ${reason}.`);
      }
    },
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
    maxSize: 10 * 1024 * 1024,
    disabled: busy || docs.length >= MAX_SOURCE_DOCS,
  });

  /**
   * A validation failure anywhere in the form must land the user on the step
   * that owns the offending field. Reachable from three entry points (wizard
   * footer, desktop CTA, mobile CTA), so it lives on `handleSubmit` rather
   * than being re-implemented per button.
   */
  const onInvalid = (errors: FieldErrors<FormValues>) => {
    const bad = Object.keys(errors) as (keyof FormValues)[];
    if (bad.length === 0) {
      toast.error("Fix the highlighted fields before generating.");
      return;
    }
    // Land on the *earliest* broken step, not whichever key the resolver
    // enumerated first — `Object.keys` order has nothing to do with step order,
    // so jumping to step 2 while step 1 is also invalid makes the user fix an
    // error, resubmit, and get thrown backwards.
    const stepOf = (field: keyof FormValues) => {
      const idx = STEP_FIELDS.findIndex((fields) => fields.includes(field));
      return idx < 0 ? STEP_FIELDS.length : idx;
    };
    const firstBad = bad.reduce((earliest, field) =>
      stepOf(field) < stepOf(earliest) ? field : earliest,
    );
    const stepIdx = stepOf(firstBad);
    if (stepIdx < STEP_FIELDS.length && stepIdx !== step) {
      setDir(stepIdx > step ? 1 : -1);
      setStep(stepIdx);
    }
    const message = (errors as Record<string, { message?: string } | undefined>)[firstBad]
      ?.message;
    toast.error(message ?? "Fix the highlighted fields before generating.");
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setGenerating(true);
    setResult(null);
    setPreviewQuestions(null);
    setPreviewFailed(false);
    // Reset the progress simulation here rather than in the effect that drives
    // it — setState inside an effect body triggers a cascading render.
    setGenPct(2);
    setGenStage(0);
    if (docsRequired && !hasGroundingDoc) {
      toast.error("Upload at least one document — you selected document-grounded mode.");
      setGenerating(false);
      return;
    }
    try {
      const res = await fetch("/api/exams/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params: { ...values, instructions: values.instructions || null },
          documentIds: sourceMode === "pure_ai"
            ? []
            : docs.filter((d) => !d.uploading && d.parseStatus === "parsed").map((d) => d.documentId),
          classId: classIdParam || undefined,
          // Deadline after which students can no longer start the exam.
          expiresAt: deadline ? new Date(deadline).toISOString() : null,
        }),
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok: true;
            examId: string;
            title: string;
            questions: number;
            tokensUsed: number;
            warnings?: string[];
          }
        | { error: string }
        | null;
      if (!res.ok || !data || !("ok" in data)) {
        toast.error(data && "error" in data ? data.error : "Generation failed.");
        return;
      }
      setGenPct(100);
      setGenStage(GEN_STAGES.length - 1);
      await new Promise((r) => setTimeout(r, 420));
      // Freeze the submitted params into the result — the form below stays
      // editable, so reading live values here would mislabel the exam. The
      // pre-flight estimate is snapshotted too, so the cost card can show a
      // real variance instead of comparing actuals against later edits.
      setResult({
        examId: data.examId,
        title: data.title,
        questions: data.questions,
        tokensUsed: data.tokensUsed,
        estimateTokens: estimateGenerationTokens(values.questionCount as number, docs.some((d) => !d.uploading && d.parseStatus === "parsed")),
        subject: values.subject as Subject,
        difficulty: values.difficulty,
        durationMinutes: values.durationMinutes,
      });
      toast.success("Exam generated — premium preview ready!", {
        description: `${data.questions} questions · ${data.tokensUsed.toLocaleString()} tokens`,
      });
      // Degradations from *after* the exam was saved (visuals dropped, tokens
      // not deducted). The generation itself succeeded, so these sit beside the
      // success toast rather than replacing it — and get longer to be read.
      for (const warning of data.warnings ?? []) {
        toast.warning(warning, { duration: 10_000 });
      }
      router.refresh();
    } catch (err) {
      const timedOut =
        err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      toast.error(
        timedOut
          ? "Generation timed out after about two minutes."
          : "Network error — check your connection and retry.",
        {
          description: timedOut
            ? "The exam may still have saved — check the library before retrying, or try fewer questions."
            : undefined,
        },
      );
      // The request may well have completed server-side after the client gave
      // up, so refresh the library the message tells them to check.
      if (timedOut) router.refresh();
    } finally {
      setGenerating(false);
    }
  }, onInvalid);

  const go = (next: number) => {
    if (next < 0 || next >= STEPS.length) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const canNext = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    if (!fields.length) return true;
    return form.trigger(fields as unknown as Parameters<typeof form.trigger>[0]);
  };

  const slide = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : {
        initial: { opacity: 0, x: dir * 16, filter: "blur(4px)" },
        animate: { opacity: 1, x: 0, filter: "blur(0px)" },
        exit: { opacity: 0, x: dir * -16, filter: "blur(4px)" },
        transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <div className="flex flex-col gap-6">
      {sourceMode === null ? (
        /* ── Source Mode Picker ───────────────────────────────────── */
        <motion.div key="mode-picker" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
        <div className="shadow-lifted gradient-border overflow-hidden rounded-2xl bg-card">
          <div className="bg-brand relative overflow-hidden p-6 text-primary-foreground">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.16]" style={{ backgroundImage: "radial-gradient(28rem 14rem at 12% 0%, rgba(255,255,255,.9), transparent 60%), radial-gradient(22rem 12rem at 88% 10%, rgba(255,255,255,.45), transparent 60%)" }} />
            <div className="relative">
              <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide opacity-85"><SparklesIcon className="size-3.5" /> AI Exam Generator</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">How should questions be sourced?</h1>
              <p className="mt-1 max-w-prose text-sm opacity-80">Choose whether Gemini creates questions from its curriculum knowledge, or derives them exclusively from your uploaded documents.</p>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {/* ── Pure AI card ── */}
              <button
                type="button"
                onClick={() => { setDocs([]); setSourceMode("pure_ai"); setStep(0); setDir(1); }}
                className="group relative flex flex-col gap-4 rounded-2xl border-2 border-border bg-card p-5 text-left shadow-card transition-all duration-200 hover:border-primary/40 hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand text-primary-foreground shadow-glow transition-transform duration-200 group-hover:scale-105"><SparklesIcon className="size-5" /></span>
                  <div>
                    <p className="text-base font-semibold tracking-tight">Pure AI Generation</p>
                    <p className="text-xs text-muted-foreground">Gemini crafts every question</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">Gemini uses its deep knowledge of the curriculum to generate original, calibrated questions. No uploads needed.</p>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" /> Curriculum-aware &amp; auto-calibrated</li>
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" /> Instant — no uploads required</li>
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" /> Original questions every time</li>
                </ul>
                <span className="mt-auto inline-flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100"><ChevronRightIcon className="size-3.5" /> Select &amp; continue</span>
              </button>

              {/* ── Document-Grounded card ── */}
              <button
                type="button"
                onClick={() => { setSourceMode("document_grounded"); setStep(0); setDir(1); }}
                className="group relative flex flex-col gap-4 rounded-2xl border-2 border-border bg-card p-5 text-left shadow-card transition-all duration-200 hover:border-primary/40 hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-glow transition-transform duration-200 group-hover:scale-105"><UploadCloudIcon className="size-5" /></span>
                  <div>
                    <p className="text-base font-semibold tracking-tight">Document-Grounded</p>
                    <p className="text-xs text-muted-foreground">Source of truth from your files</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">Upload past papers, PDFs, or scanned documents. Questions are derived exclusively from your material — the AI structures and formats them.</p>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-violet-500" /> Questions faithful to your source</li>
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-violet-500" /> PDF, scanned docs &amp; images up to 10 MB</li>
                  <li className="flex items-center gap-2"><CheckCircle2Icon className="size-3.5 shrink-0 text-violet-500" /> Perfect for past-paper exams</li>
                </ul>
                <span className="mt-auto inline-flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100"><ChevronRightIcon className="size-3.5" /> Select &amp; continue</span>
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">You can change this later by going back from the first wizard step.</p>
          </div>
        </div>
        </motion.div>
      ) : (<>
      {/* ── Row layout: Create exam + Estimated cost side-by-side on lg ── */}
      <div className="grid gap-6 lg:grid-cols-3 items-start">
        {/* Left: Wizard — col-span-2 on desktop, full width on mobile */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
              }
            }}
            noValidate
            className="flex flex-col gap-0"
          >
            {/* Premium header */}
            <div className="shadow-lifted gradient-border overflow-hidden rounded-2xl bg-card">
              <div className="bg-brand relative overflow-hidden p-6 text-primary-foreground">
                <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.16]" style={{ backgroundImage: "radial-gradient(28rem 14rem at 12% 0%, rgba(255,255,255,.9), transparent 60%), radial-gradient(22rem 12rem at 88% 10%, rgba(255,255,255,.45), transparent 60%)" }} />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide opacity-85"><SparklesIcon className="size-3.5" /> AI Exam Generator</p>
                    <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Create a premium exam</h1>
                    <p className="mt-1 max-w-prose text-sm opacity-80">Curriculum-aware, proctored, and cost-transparent. Dropdowns keep the form compact and in sync.</p>
                  </div>
                  <Badge variant="secondary" className="hidden shrink-0 gap-1.5 bg-white/15 text-white backdrop-blur sm:inline-flex"><ZapIcon className="size-3" /> Gemini powered</Badge>
                </div>
                <div className="relative mt-5 flex items-center gap-2">
                  {/* Source mode — always done once the wizard is visible */}
                  <button type="button" onClick={() => setSourceMode(null)} disabled={busy} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 border-white/30 bg-white/10 text-white">
                    <span className="grid size-5 place-items-center rounded-full text-[10px] font-bold bg-white text-primary"><CheckCircle2Icon className="size-3.5" /></span>
                    <span className="hidden sm:inline">Source</span>
                    {sourceMode === "pure_ai" ? <SparklesIcon className="hidden size-3.5 sm:block opacity-80" /> : <UploadCloudIcon className="hidden size-3.5 sm:block opacity-80" />}
                  </button>
                  {STEPS.map((s, i) => {
                    const active = i === step;
                    const done = i < step;
                    return (
                      <button key={s.id} type="button" onClick={() => go(i)} disabled={busy} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-white bg-white text-primary shadow-glow" : done ? "border-white/30 bg-white/10 text-white" : "border-white/20 bg-white/10 text-white/70"}`}>
                        <span className={`grid size-5 place-items-center rounded-full text-[10px] font-bold ${active ? "bg-primary text-white" : done ? "bg-white text-primary" : "bg-white/15"}`}>{done ? <CheckCircle2Icon className="size-3.5" /> : i + 1}</span>
                        <span className="hidden sm:inline">{s.label}</span>
                        <s.icon className="hidden size-3.5 sm:block opacity-80" />
                      </button>
                    );
                  })}
                  <div className="ml-auto hidden items-center gap-2 text-xs font-medium opacity-80 sm:flex">
                    <span>Step {step + 2} of {STEPS.length + 1}</span>
                    <span className="size-1 rounded-full bg-white/60" />
                    <span className="hidden sm:inline">{STEPS[step].desc}</span>
                  </div>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <motion.div className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.6)]" initial={false} animate={{ width: `${((step + 2) / (STEPS.length + 1)) * 100}%` }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} />
                </div>
              </div>

              {/* Wizard body */}
              <div className="p-5 sm:p-6">
                {/*
                  A generation is already paid for by the time it returns, so the
                  params must not drift under it — an edit mid-flight would label
                  the saved exam with values it wasn't generated from. `min-w-0`
                  defuses the fieldset's `min-inline-size: min-content` default,
                  which otherwise stops the grid children from shrinking.
                */}
                <fieldset disabled={busy} className="min-w-0">
                <AnimatePresence mode="wait" initial={false} custom={dir}>
                  <motion.div key={STEPS[step].id} custom={dir} initial={slide.initial} animate={slide.animate} exit={slide.exit} transition={slide.transition} className="will-change-transform">
                    {step === 0 && (
                      <FieldGroup>
                        {lockedScope && (
                          <div className="bg-brand-soft/60 flex items-center gap-2.5 rounded-xl border border-primary/25 px-4 py-2.5 text-sm">
                            <LockIcon className="text-primary size-4 shrink-0" />
                            <p className="min-w-0">
                              Generating for{" "}
                              <strong className="text-foreground">
                                {classNameParam || "your class"}
                              </strong>{" "}
                              — level, sub-level and class are fixed. Pick the
                              subject and remaining fields.
                            </p>
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field>
                            <FieldLabel className="flex items-center gap-1.5"><LayersIcon className="size-3.5 text-primary" /> Level</FieldLabel>
                            <Controller
                              control={form.control}
                              name="level"
                              render={({ field }) => (
                                <Select
                                  disabled={lockedScope}
                                  value={field.value}
                                  onValueChange={(v) => {
                                    const next = v as "primary" | "secondary";
                                    field.onChange(next);
                                    if (next === "primary") {
                                      form.setValue("secondarySubLevel", null);
                                      form.setValue("subsidiary", null);
                                      form.setValue("classLevel", 5);
                                      if (!(COUNTRY_CURRICULA.UG.primary as readonly string[]).includes(form.getValues("subject"))) {
                                        form.setValue("subject", COUNTRY_CURRICULA.UG.primary[0]);
                                      }
                                    } else {
                                      const sub = form.getValues("secondarySubLevel") === "a_level" ? "a_level" : "o_level";
                                      form.setValue("secondarySubLevel", sub);
                                      form.setValue("classLevel", sub === "a_level" ? 5 : 2);
                                      if (!(SECONDARY_SUBJECTS_BY_SUB_LEVEL[sub] as readonly string[]).includes(form.getValues("subject"))) {
                                        form.setValue("subject", SECONDARY_SUBJECTS_BY_SUB_LEVEL[sub][0] as FormValues["subject"]);
                                      }
                                    }
                                  }}
                                >
                                  <SelectTrigger className={premiumTrigger}>
                                    <span className="flex items-center gap-2"><LayersIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                      value={level}
                                      options={[
                                        { value: "primary", label: "Primary (P1–P7)" },
                                        { value: "secondary", label: "Secondary (S1–S6)" },
                                      ]}
                                    /></span>
                                  </SelectTrigger>
                                  <SelectContent className={premiumContent}>
                                    <SelectItem value="primary"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />Primary (P1–P7)</span></SelectItem>
                                    <SelectItem value="secondary"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-violet-500" />Secondary (S1–S6)</span></SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            <FieldDescription>Switching animates dependent dropdowns.</FieldDescription>
                          </Field>

                          <Field>
                            <FieldLabel htmlFor="classLevel" className="flex items-center gap-1.5"><GraduationCapIcon className="size-3.5 text-primary" /> Class</FieldLabel>
                            <Controller
                              control={form.control}
                              name="classLevel"
                              render={({ field }) => (
                                <Select disabled={lockedScope} value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                                  <SelectTrigger id="classLevel" className={premiumTrigger}>
                                    <span className="flex items-center gap-2"><GraduationCapIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                      value={String(classLevel)}
                                      options={classLevelOptions(level, subLevel).map((opt) => ({
                                        value: String(opt.value),
                                        label: opt.label,
                                      }))}
                                    /></span>
                                  </SelectTrigger>
                                  <SelectContent className={premiumContent}>
                                    {classLevelOptions(level, subLevel).map((opt) => (
                                      <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            {form.formState.errors.classLevel && <FieldError>{form.formState.errors.classLevel.message}</FieldError>}
                          </Field>
                        </div>

                        <AnimatePresence>
                          {level === "secondary" && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                              <Controller
                                control={form.control}
                                name="secondarySubLevel"
                                render={({ field }) => (
                                  <Field>
                                    <FieldLabel className="flex items-center gap-1.5"><LayersIcon className="size-3.5 text-primary" /> Secondary sub-level</FieldLabel>
                                    <Select
                                      disabled={lockedScope}
                                      value={field.value ?? "o_level"}
                                      onValueChange={(v) => {
                                        const next = v as "o_level" | "a_level";
                                        field.onChange(next);
                                        form.setValue("classLevel", next === "a_level" ? 5 : 2);
                                        if (!(SECONDARY_SUBJECTS_BY_SUB_LEVEL[next] as readonly string[]).includes(form.getValues("subject"))) {
                                          form.setValue("subject", SECONDARY_SUBJECTS_BY_SUB_LEVEL[next][0] as FormValues["subject"]);
                                        }
                                      }}
                                    >
                                      <SelectTrigger className={premiumTrigger}>
                                        <span className="flex items-center gap-2"><LayersIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                          value={subLevel}
                                          options={[
                                            { value: "o_level", label: SUB_LEVEL_LABELS.o_level },
                                            { value: "a_level", label: SUB_LEVEL_LABELS.a_level },
                                          ]}
                                        /></span>
                                      </SelectTrigger>
                                      <SelectContent className={premiumContent}>
                                        <SelectItem value="o_level">{SUB_LEVEL_LABELS.o_level}</SelectItem>
                                        <SelectItem value="a_level">{SUB_LEVEL_LABELS.a_level}</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                )}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field data-invalid={form.formState.errors.subject ? true : undefined}>
                            <FieldLabel htmlFor="subject" className="flex items-center gap-1.5"><BookOpenIcon className="size-3.5 text-primary" /> Subject</FieldLabel>
                            <Controller
                              control={form.control}
                              name="subject"
                              render={({ field }) => (
                                <Select
                                  value={field.value}
                                  onValueChange={(v) => {
                                    field.onChange(v);
                                    const subs = SUBJECT_SUBSIDIARIES[v as keyof typeof SUBJECT_SUBSIDIARIES];
                                    if (!subs) form.setValue("subsidiary", null);
                                  }}
                                >
                                  <SelectTrigger id="subject" className={premiumTrigger}>
                                    <span className="flex items-center gap-2"><BookOpenIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                      value={subject}
                                      options={subjects.map((s) => ({ value: s, label: SUBJECT_LABELS[s] }))}
                                    /></span>
                                  </SelectTrigger>
                                  <SelectContent className={premiumContent}>
                                    {subjects.map((s) => (
                                      <SelectItem key={s} value={s}>{SUBJECT_LABELS[s]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                            {form.formState.errors.subject && <FieldError>{form.formState.errors.subject.message}</FieldError>}
                          </Field>

                          <Field data-invalid={form.formState.errors.topic ? true : undefined}>
                            <FieldLabel htmlFor="topic" className="flex items-center gap-1.5"><FileTextIcon className="size-3.5 text-primary" /> Topic / theme</FieldLabel>
                            <Input id="topic" placeholder="e.g. Linear equations & word problems" aria-invalid={!!form.formState.errors.topic} className="h-11 rounded-xl border bg-card shadow-card focus-visible:ring-2 focus-visible:ring-primary/20" {...form.register("topic")} />
                            {form.formState.errors.topic && <FieldError>{form.formState.errors.topic.message}</FieldError>}
                          </Field>
                        </div>

                        <AnimatePresence>
                          {needsSubsidiary && (
                            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                              <Field data-invalid={form.formState.errors.subsidiary ? true : undefined}>
                                <FieldLabel htmlFor="subsidiary" className="flex items-center gap-1.5"><TagIcon className="size-3.5 text-primary" />{SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES]?.label}</FieldLabel>
                                <Controller
                                  control={form.control}
                                  name="subsidiary"
                                  render={({ field }) => (
                                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                                      <SelectTrigger id="subsidiary" className={premiumTrigger}>
                                        <span className="flex items-center gap-2"><TagIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                          value={subsidiary ?? ""}
                                          placeholder="Choose the branch"
                                          options={(
                                            SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES]?.options ?? []
                                          ).map((opt) => ({ value: opt, label: SUBSIDIARY_LABELS[opt] ?? opt }))}
                                        /></span>
                                      </SelectTrigger>
                                      <SelectContent className={premiumContent}>
                                        {SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES]!.options.map((opt) => (
                                          <SelectItem key={opt} value={opt}>{SUBSIDIARY_LABELS[opt] ?? opt}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                />
                                {form.formState.errors.subsidiary ? <FieldError>{form.formState.errors.subsidiary.message}</FieldError> : <FieldDescription>Questions will focus strictly on the chosen branch.</FieldDescription>}
                              </Field>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </FieldGroup>
                    )}

                    {step === 1 && (
                      <FieldGroup>
                        <Field data-invalid={form.formState.errors.questionTypes ? true : undefined}>
                          <FieldLabel className="flex items-center gap-1.5"><FileQuestionIcon className="size-3.5 text-primary" /> Question types</FieldLabel>
                          <Controller
                            control={form.control}
                            name="questionTypes"
                            render={({ field }) => {
                              const selected = field.value as string[];
                              return (
                                <Popover>
                                  <PopoverTrigger render={<Button variant="outline" className="h-auto min-h-11 w-full justify-between rounded-xl border bg-card px-3 py-2 shadow-card hover:shadow-lifted hover:border-primary/20 hover:bg-accent/30 transition-all group" />}>
                                    <span className="flex flex-wrap gap-1.5">
                                      {selected.length === 0 ? <span className="text-muted-foreground text-sm flex items-center gap-2"><FileQuestionIcon className="size-4" /> Select types…</span> : selected.map((t) => <Badge key={t} variant="secondary" className="gap-1 shadow-sm">{QUESTION_TYPE_LABELS[t as keyof typeof QUESTION_TYPE_LABELS]}</Badge>)}
                                    </span>
                                    <ChevronDownIcon className="size-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                                  </PopoverTrigger>
                                  <PopoverContent align="start" className="w-[min(420px,95vw)] rounded-2xl p-3 shadow-lifted border bg-popover/95 backdrop-blur-xl">
                                    <p className="mb-2 text-xs font-medium text-muted-foreground">Pick at least one — saves space as badges</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      {QUESTION_TYPES.map((t) => {
                                        const checked = selected.includes(t);
                                        return (
                                          <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-all hover:shadow-card ${checked ? "border-primary bg-primary/10 shadow-glow" : "hover:bg-accent/50 border-border"}`}>
                                            <Checkbox checked={checked} onCheckedChange={(c) => {
                                              const next = c ? [...selected, t] : selected.filter((x) => x !== t);
                                              field.onChange(next);
                                            }} />
                                            <span className="text-sm font-medium">{QUESTION_TYPE_LABELS[t]}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              );
                            }}
                          />
                          {form.formState.errors.questionTypes && <FieldError>{form.formState.errors.questionTypes.message}</FieldError>}
                          <FieldDescription>Premium multi-select — compact badges, check to toggle.</FieldDescription>
                        </Field>

                        <Field data-invalid={form.formState.errors.difficulty ? true : undefined}>
                          <FieldLabel className="flex items-center gap-1.5"><TargetIcon className="size-3.5 text-primary" /> Difficulty</FieldLabel>
                          <Controller
                            control={form.control}
                            name="difficulty"
                            render={({ field }) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger className={premiumTrigger}>
                                  <span className="flex items-center gap-2"><TargetIcon className="size-4 text-muted-foreground group-data-[state=open]:text-primary transition-colors" /><SelectDisplay
                                    value={difficulty}
                                    options={DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))}
                                  /></span>
                                </SelectTrigger>
                                <SelectContent className={premiumContent}>
                                  {DIFFICULTIES.map((d) => (
                                    <SelectItem key={d} value={d}>
                                      <span className="inline-flex items-center gap-2"><span className={`size-2.5 rounded-full shadow-sm ${d === "easy" ? "bg-emerald-500" : d === "medium" ? "bg-amber-500" : d === "hard" ? "bg-orange-500" : "bg-red-500"}`} />{DIFFICULTY_LABELS[d]}</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </Field>

                        <div className="grid gap-5 sm:grid-cols-2">
                          <Field data-invalid={form.formState.errors.questionCount ? true : undefined}>
                            <FieldLabel htmlFor="questionCount" className="flex items-center gap-1.5"><FileQuestionIcon className="size-3.5 text-primary" /> Questions: <span className="text-foreground font-semibold tabular-nums">{questionCount}</span></FieldLabel>
                            <Controller control={form.control} name="questionCount" render={({ field }) => <Slider id="questionCount" min={EXAM_QUESTIONS_MIN} max={EXAM_QUESTIONS_MAX} step={1} value={[field.value]} onValueChange={(v) => field.onChange((Array.isArray(v) ? v[0] : v) ?? field.value)} disabled={busy} className="py-2" />} />
                            {form.formState.errors.questionCount ? <FieldError>{form.formState.errors.questionCount.message}</FieldError> : <FieldDescription>{EXAM_QUESTIONS_MIN}–{EXAM_QUESTIONS_MAX} questions per exam.</FieldDescription>}
                          </Field>
                          <Field data-invalid={form.formState.errors.durationMinutes ? true : undefined}>
                            <FieldLabel htmlFor="durationMinutes" className="flex items-center gap-1.5"><ClockIcon className="size-3.5 text-primary" /> Duration: <span className="text-foreground font-semibold tabular-nums">{durationMinutes} min</span></FieldLabel>
                            <Controller control={form.control} name="durationMinutes" render={({ field }) => <Slider id="durationMinutes" min={EXAM_DURATION_MIN} max={EXAM_DURATION_MAX} step={5} value={[field.value]} onValueChange={(v) => field.onChange((Array.isArray(v) ? v[0] : v) ?? field.value)} disabled={busy} className="py-2" />} />
                            {form.formState.errors.durationMinutes ? <FieldError>{form.formState.errors.durationMinutes.message}</FieldError> : <FieldDescription>Countdown is enforced server-side.</FieldDescription>}
                          </Field>
                        </div>

                        <Field>
                          <FieldLabel htmlFor="deadline" className="flex items-center gap-1.5"><CalendarClockIcon className="size-3.5 text-primary" /> Deadline (optional)</FieldLabel>
                          <Input
                            id="deadline"
                            type="datetime-local"
                            value={deadline}
                            min={mountedAtIso.slice(0, 16)}
                            onChange={(e) => setDeadline(e.target.value)}
                            disabled={busy}
                            className="max-w-64"
                          />
                          <FieldDescription>
                            After this date and time students can no longer start the exam — leave empty for no expiry.
                          </FieldDescription>
                        </Field>

                        <div className="grid gap-3 sm:grid-cols-3">
                          {(["includeHints", "includeExplanations", "includeWorkedExamples"] as const).map((name) => {
                            const labels: Record<string, string> = { includeHints: "Hints", includeExplanations: "Explanations", includeWorkedExamples: "Worked examples" };
                            const icons: Record<string, typeof SparklesIcon> = { includeHints: SparklesIcon, includeExplanations: BookOpenIcon, includeWorkedExamples: LayersIcon };
                            const Icon = icons[name] ?? SparklesIcon;
                            return (
                              <Field key={name}>
                                <label htmlFor={name} className="group hover:bg-accent/40 flex h-14 cursor-pointer items-center justify-between rounded-xl border bg-card px-4 shadow-card hover:shadow-lifted transition-all">
                                  <span className="flex items-center gap-2 text-sm font-medium"><Icon className="size-3.5 text-primary" />{labels[name]}</span>
                                  <Controller control={form.control} name={name} render={({ field }) => <Switch id={name} checked={field.value as boolean} onCheckedChange={field.onChange} />} />
                                </label>
                              </Field>
                            );
                          })}
                        </div>

                        <Field>
                          <FieldLabel htmlFor="instructions">Special instructions (optional)</FieldLabel>
                          <Textarea id="instructions" rows={2} placeholder="e.g. Focus on past-paper style word problems, avoid geometry." className="rounded-xl border bg-card shadow-card focus-visible:ring-2 focus-visible:ring-primary/20" {...form.register("instructions")} />
                        </Field>
                      </FieldGroup>
                    )}

                    {step === 2 && (
                      <FieldGroup>
                        <div className="space-y-3">
                          <FieldLabel>Exam session rules</FieldLabel>
                          <p className="text-muted-foreground text-xs">Secure defaults: no backtrack, no review, skipping allowed, fullscreen required. Recording is off by default.</p>
                          <div className="grid gap-3">
                            {(
                              [
                                ["preventBacktrack", "Prevent going back", "Once Next is pressed you cannot see that question again.", LockIcon],
                                ["allowReviewBeforeSubmit", "Allow review before submit", "Show review screen before final submit (off = direct submit).", ShieldCheckIcon],
                                ["allowSkipping", "Allow skipping", "Students can Next without answering (blank = 0).", ZapIcon],
                                ["requireFullscreen", "Require fullscreen", "Auto-enter fullscreen and block exit until submit.", MonitorIcon],
                                ["enableCameraRecording", "Record camera", "Save camera video to review after exam. Disabled by default.", CameraIcon],
                                ["enableScreenRecording", "Record screen", "Save entire-screen video to review after exam. Disabled by default.", VideoIcon],
                              ] as const
                            ).map(([name, label, hint, Icon]) => (
                              <Field key={name}>
                                <label htmlFor={name} className="group hover:bg-accent/30 flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-card hover:shadow-lifted transition-all">
                                  <span className="flex items-center gap-3">
                                    <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors"><Icon className="size-4" /></span>
                                    <span className="flex flex-col">
                                      <span className="text-sm font-medium">{label}</span>
                                      <span className="text-muted-foreground text-xs">{hint}</span>
                                    </span>
                                  </span>
                                  <Controller control={form.control} name={name as keyof FormValues} render={({ field }) => <Switch id={name} checked={field.value as boolean} onCheckedChange={field.onChange} />} />
                                </label>
                              </Field>
                            ))}
                          </div>
                        </div>

                        {sourceMode === "pure_ai" ? (
                          <div className="rounded-2xl border border-dashed bg-muted/20 p-4">
                            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><SparklesIcon className="size-4" /> Pure AI mode — no source documents</p>
                            <p className="text-muted-foreground mt-1 text-xs">Gemini generates all questions from its curriculum knowledge. Go back to change your source mode.</p>
                          </div>
                        ) : (
                        <div className="rounded-2xl border bg-card p-4 shadow-card">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <p className="flex items-center gap-2 text-sm font-medium"><UploadCloudIcon className="size-4 text-primary" /> Source material</p>
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">required</Badge>
                            </div>
                            <span className="text-[11px] text-muted-foreground font-medium">Max 10 MB per file</span>
                          </div>
                          <p className="text-muted-foreground mt-1 text-xs">Upload past papers, PDFs, or scanned documents — questions will be derived faithfully from your material.</p>
                          <div
                            {...getRootProps()}
                            className={`mt-3 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-all ${isDragActive ? "border-primary bg-primary/5 shadow-glow scale-[1.01]" : "hover:border-primary/40 hover:bg-accent/20"}`}
                          >
                            <input {...getInputProps()} />
                            <span className={`grid size-11 place-items-center rounded-2xl transition-colors ${isDragActive ? "bg-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"}`}><UploadCloudIcon className="size-5" /></span>
                            <div>
                              <p className="text-sm font-semibold">{isDragActive ? "Drop documents here…" : "Drag & drop files or click to browse"}</p>
                              <p className="text-muted-foreground mt-0.5 text-xs">Supports PDF, scanned documents/photos (JPG, PNG, WEBP), DOCX &amp; TXT</p>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-[11px]">
                              <span className="rounded-md border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground">PDF</span>
                              <span className="rounded-md border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground">Scanned Papers</span>
                              <span className="rounded-md border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground">JPG / PNG</span>
                              <span className="rounded-md border bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground">Up to 10 MB</span>
                            </div>
                          </div>

                          <ul className="mt-3 flex flex-col gap-3">
                            <AnimatePresence initial={false}>
                              {docs.map((d) => {
                                const isImg = /\.(jpe?g|png|webp|gif|bmp)$/i.test(d.name);
                                const IconComp = isImg ? CameraIcon : FileTextIcon;
                                return (
                                  <motion.li key={d.documentId} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97, y: -6 }} className="group overflow-hidden rounded-2xl border bg-card shadow-card hover:shadow-lifted transition-all">
                                    <div className="flex items-center gap-3 px-3.5 py-3">
                                      <span className={`grid size-9 place-items-center rounded-xl border shadow-sm transition-colors ${d.uploading ? "bg-brand text-primary-foreground border-primary shadow-glow" : d.parseStatus === "parsed" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-amber-500/10 border-amber-500/20 text-amber-600"}`}>
                                        {d.uploading ? <Loader2Icon className="size-4 animate-spin" /> : d.parseStatus === "parsed" ? <CheckCircle2Icon className="size-4" /> : <IconComp className="size-4" />}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium leading-none">{d.name}</p>
                                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <span className="tabular-nums">{d.sizeLabel}</span>
                                          <span className="size-1 rounded-full bg-muted-foreground/30" />
                                          {d.uploading ? (
                                            <span className="inline-flex items-center gap-1 text-primary font-medium">
                                              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                                              Uploading &amp; analyzing {d.progress}%
                                            </span>
                                          ) : d.parseStatus === "parsed" ? (
                                            <span className="text-emerald-600 font-medium">Ready — grounded with AI</span>
                                          ) : (
                                            <span className="text-amber-600 font-medium">Unreadable — will skip</span>
                                          )}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {d.uploading ? (
                                          <Badge variant="secondary" className="tabular-nums bg-primary/10 text-primary border-primary/20">{d.progress}%</Badge>
                                        ) : d.parseStatus === "parsed" ? (
                                          <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300"><CheckCircle2Icon className="size-3" /> Ready</Badge>
                                        ) : (
                                          <Badge variant="outline" className="border-amber-500/30 text-amber-700">Unreadable</Badge>
                                        )}
                                        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${d.name}`} onClick={() => setDocs((prev) => prev.filter((x) => x.documentId !== d.documentId))} className="opacity-60 group-hover:opacity-100"><XIcon className="size-3" /></Button>
                                      </div>
                                    </div>
                                    {/* Beautiful progress */}
                                    <div className="h-1.5 w-full bg-muted/30 overflow-hidden">
                                      <motion.div
                                        className={`h-full ${d.uploading ? "bg-brand shadow-glow bg-shimmer" : d.parseStatus === "parsed" ? "bg-emerald-500" : "bg-amber-500"}`}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${d.uploading ? d.progress : 100}%` }}
                                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                                      />
                                    </div>
                                  </motion.li>
                                );
                              })}
                            </AnimatePresence>
                          </ul>
                          {!hasGroundingDoc && <p className="mt-3 text-center text-xs font-medium text-amber-600 dark:text-amber-400">Upload at least one readable document to enable generation.</p>}
                        </div>
                        )}
                      </FieldGroup>
                    )}

                    {step === 3 && (
                      <div className="flex flex-col gap-4">
                        <div>
                          <h3 className="text-base font-semibold tracking-tight">Review exam configuration</h3>
                          <p className="text-muted-foreground text-xs">Verify all parameters and source material before starting Gemini generation.</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {/* 1. Source & Curriculum */}
                          <div className="rounded-2xl border bg-card p-4 shadow-card flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  <BookOpenIcon className="size-3.5 text-primary" /> Curriculum &amp; Topic
                                </span>
                                <Button type="button" variant="ghost" size="xs" onClick={() => go(0)} className="h-6 text-xs text-primary hover:underline px-1.5">
                                  Edit
                                </Button>
                              </div>
                              <div className="mt-3 space-y-2">
                                <div>
                                  <p className="text-xs text-muted-foreground">Subject &amp; Level</p>
                                  <p className="text-sm font-semibold text-foreground">
                                    {SUBJECT_LABELS[subject as keyof typeof SUBJECT_LABELS] ?? subject}
                                    {subsidiary ? ` · ${SUBSIDIARY_LABELS[subsidiary] ?? subsidiary}` : ""}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {level === "primary"
                                      ? `Primary · Class P${classLevel}`
                                      : `Secondary (${subLevel === "a_level" ? "A-Level" : "O-Level"}) · Class S${classLevel}`}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Topic / Theme</p>
                                  <p className="text-sm font-medium text-foreground">{topic || "Not specified"}</p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                              <span>Source Mode</span>
                              <Badge variant={sourceMode === "pure_ai" ? "secondary" : "default"} className="text-[10px] gap-1">
                                {sourceMode === "pure_ai" ? <SparklesIcon className="size-3" /> : <UploadCloudIcon className="size-3" />}
                                {sourceMode === "pure_ai" ? "Pure AI" : `Grounded (${docs.filter(d => d.parseStatus === "parsed").length} docs)`}
                              </Badge>
                            </div>
                          </div>

                          {/* 2. Format & Calibration */}
                          <div className="rounded-2xl border bg-card p-4 shadow-card flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  <LayersIcon className="size-3.5 text-primary" /> Format &amp; Calibration
                                </span>
                                <Button type="button" variant="ghost" size="xs" onClick={() => go(1)} className="h-6 text-xs text-primary hover:underline px-1.5">
                                  Edit
                                </Button>
                              </div>
                              <div className="mt-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs text-muted-foreground">Volume &amp; Timing</p>
                                    <p className="text-sm font-semibold text-foreground">{questionCount} Questions · {durationMinutes} min</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs text-muted-foreground">Difficulty</p>
                                    <Badge variant="outline" className="gap-1 capitalize text-xs">
                                      <span className={`size-2 rounded-full ${difficulty === "easy" ? "bg-emerald-500" : difficulty === "medium" ? "bg-amber-500" : difficulty === "hard" ? "bg-orange-500" : "bg-red-500"}`} />
                                      {DIFFICULTY_LABELS[difficulty as keyof typeof DIFFICULTY_LABELS] ?? difficulty}
                                    </Badge>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Question Types</p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {(questionTypes ?? []).map((t) => (
                                      <Badge key={t} variant="secondary" className="text-[10px]">
                                        {QUESTION_TYPE_LABELS[t as keyof typeof QUESTION_TYPE_LABELS] ?? t}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-muted-foreground">
                                  {includeHints && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">Hints</span>}
                                  {includeExplanations && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">Explanations</span>}
                                  {includeWorkedExamples && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">Worked Examples</span>}
                                </div>
                              </div>
                            </div>
                            {instructions && (
                              <div className="mt-3 pt-3 border-t text-xs">
                                <p className="text-muted-foreground">Instructions: <span className="font-medium text-foreground italic line-clamp-1">{instructions}</span></p>
                              </div>
                            )}
                          </div>

                          {/* 3. Session Policy */}
                          <div className="rounded-2xl border bg-card p-4 shadow-card flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  <ShieldCheckIcon className="size-3.5 text-primary" /> Session Security
                                </span>
                                <Button type="button" variant="ghost" size="xs" onClick={() => go(2)} className="h-6 text-xs text-primary hover:underline px-1.5">
                                  Edit
                                </Button>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${preventBacktrack ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={preventBacktrack ? "text-foreground font-medium" : "text-muted-foreground"}>No backtracking</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${allowReviewBeforeSubmit ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={allowReviewBeforeSubmit ? "text-foreground font-medium" : "text-muted-foreground"}>Review enabled</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${allowSkipping ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={allowSkipping ? "text-foreground font-medium" : "text-muted-foreground"}>Skipping allowed</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${requireFullscreen ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={requireFullscreen ? "text-foreground font-medium" : "text-muted-foreground"}>Fullscreen locked</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${enableCameraRecording ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={enableCameraRecording ? "text-foreground font-medium" : "text-muted-foreground"}>Camera recording</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`size-2 rounded-full ${enableScreenRecording ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                                  <span className={enableScreenRecording ? "text-foreground font-medium" : "text-muted-foreground"}>Screen recording</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 4. Grounding Material or Cost Quota */}
                          <div className="rounded-2xl border bg-card p-4 shadow-card flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {sourceMode === "document_grounded" ? <UploadCloudIcon className="size-3.5 text-primary" /> : <ZapIcon className="size-3.5 text-primary" />}
                                  {sourceMode === "document_grounded" ? "Source Documents" : "Generation Estimate"}
                                </span>
                                {sourceMode === "document_grounded" && (
                                  <Button type="button" variant="ghost" size="xs" onClick={() => go(2)} className="h-6 text-xs text-primary hover:underline px-1.5">
                                    Edit
                                  </Button>
                                )}
                              </div>
                              {sourceMode === "document_grounded" ? (
                                <div className="mt-3 space-y-1.5">
                                  {docs.filter(d => d.parseStatus === "parsed").length > 0 ? (
                                    docs.filter(d => d.parseStatus === "parsed").map(d => (
                                      <div key={d.documentId} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs">
                                        <span className="truncate max-w-[180px] font-medium">{d.name}</span>
                                        <span className="text-muted-foreground tabular-nums text-[11px]">{d.sizeLabel}</span>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">No valid documents uploaded yet.</p>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  <p className="text-xs text-muted-foreground">Estimated tokens: <strong className="text-foreground">{estimate.toLocaleString()}</strong></p>
                                  <p className="text-xs text-muted-foreground">Holding reserve: <strong className="text-foreground">{formatTokens(reserve)} tokens</strong></p>
                                  <p className="text-[11px] text-muted-foreground leading-relaxed">Questions drafted with curriculum calibration.</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* Wizard nav — explicit Generate button */}
                <div className="mt-6 flex items-center justify-between gap-3 border-t pt-5">
                  <Button type="button" variant="outline" onClick={() => { if (step === 0) { setSourceMode(null); } else { go(step - 1); } }} className="min-w-[96px] rounded-xl">
                    <ChevronLeftIcon data-icon="inline-start" /> Back
                  </Button>
                  <div className="hidden items-center gap-1.5 sm:flex">
                    <span className="h-1.5 w-3 rounded-full bg-primary/40" />
                    {STEPS.map((_, i) => (
                      <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/40" : "w-3 bg-muted-foreground/20"}`} />
                    ))}
                  </div>
                  {step < STEPS.length - 1 ? (
                    <Button
                      key="btn-next"
                      type="button"
                      onClick={async () => {
                        if (await canNext()) go(step + 1);
                      }}
                      className="shadow-glow min-w-[108px] rounded-xl"
                    >
                      Next <ChevronRightIcon data-icon="inline-end" />
                    </Button>
                  ) : (
                    <Button
                      key="btn-generate"
                      type="button"
                      onClick={() => void onSubmit()}
                      size="lg"
                      className="shadow-glow h-11 min-w-[168px] rounded-xl font-semibold"
                      disabled={busy || uploadsPending || (docsRequired && !hasGroundingDoc)}
                    >
                      {busy ? (
                        <>
                          <Loader2Icon data-icon="inline-start" className="animate-spin" /> Generating… {Math.round(genPct)}%
                        </>
                      ) : (
                        <>
                          <SparklesIcon data-icon="inline-start" /> Generate exam
                        </>
                      )}
                    </Button>
                  )}
                </div>
                </fieldset>
              </div>
            </div>
          </form>
        </div>

        {/* Right: Cost summary — estimate before generation, actuals after.
            No CTA lives here: the single Generate button is the wizard
            footer's final-step button. */}
        <div className="lg:sticky lg:top-6 lg:self-start flex flex-col gap-6">
          <Card className="shadow-lifted overflow-hidden rounded-2xl border">
            {result && !generating ? (
              <>
                <div className="bg-brand-soft relative overflow-hidden p-5">
                  <div aria-hidden className="pointer-events-none absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(20rem 10rem at 20% 0%, white, transparent 60%)" }} />
                  <p className="relative flex items-center gap-2 text-sm font-medium"><CheckCircle2Icon className="size-4 text-emerald-600" /> Actual cost</p>
                  <p className="relative mt-1 text-3xl font-semibold tabular-nums">{formatUsd(tokensToUsd(result.tokensUsed))}</p>
                  <p className="text-muted-foreground relative text-sm">≈ {formatUgx(usdToUgx(tokensToUsd(result.tokensUsed)))} · {result.tokensUsed.toLocaleString()} tokens</p>
                  <div className="relative mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="gap-1"><LayersIcon className="size-3" /> {result.questions} Qs</Badge>
                    <Badge variant="secondary" className="gap-1"><ClockIcon className="size-3" /> {result.durationMinutes} min</Badge>
                    {(() => {
                      const variance = result.estimateTokens - result.tokensUsed;
                      const pct = result.estimateTokens > 0 ? Math.round((Math.abs(variance) / result.estimateTokens) * 100) : 0;
                      const under = variance >= 0;
                      return (
                        <Badge variant="outline" className={`gap-1 tabular-nums ${under ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                          {under ? "↓" : "↑"} {Math.abs(variance).toLocaleString()} ({pct}%) {under ? "under" : "over"} estimate
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <CardContent className="flex flex-col gap-4 p-5">
                  <dl className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Tokens used</dt>
                      <dd className="font-semibold tabular-nums">{result.tokensUsed.toLocaleString()}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Estimated tokens</dt>
                      <dd className="text-muted-foreground tabular-nums">{result.estimateTokens.toLocaleString()}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Avg per question</dt>
                      <dd className="tabular-nums">~{result.questions > 0 ? Math.round(result.tokensUsed / result.questions).toLocaleString() : "—"} tokens</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Charged (USD / UGX)</dt>
                      <dd className="font-semibold tabular-nums">{formatUsd(tokensToUsd(result.tokensUsed))} · {formatUgx(usdToUgx(tokensToUsd(result.tokensUsed)))}</dd>
                    </div>
                  </dl>
                  <Separator />
                  <p className="text-muted-foreground text-xs leading-relaxed">Charged to your wallet — any unused reserve hold was released. Full exam is saved to your library; preview it below.</p>
                </CardContent>
              </>
            ) : (
              <>
                <div className="bg-brand-soft relative overflow-hidden p-5">
                  <div aria-hidden className="pointer-events-none absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(20rem 10rem at 20% 0%, white, transparent 60%)" }} />
                  <p className="relative flex items-center gap-2 text-sm font-medium"><SparklesIcon className="size-4 text-primary" /> Estimated cost</p>
                  <p className="relative mt-1 text-3xl font-semibold tabular-nums">{formatUsd(tokensToUsd(estimate))}</p>
                  <p className="text-muted-foreground relative text-sm">≈ {formatUgx(usdToUgx(tokensToUsd(estimate)))} · ~{estimate.toLocaleString()} tokens</p>
                  <div className="relative mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="gap-1"><LayersIcon className="size-3" /> {questionCount} Qs</Badge>
                    <Badge variant="secondary" className="gap-1"><ClockIcon className="size-3" /> {durationMinutes} min</Badge>
                    {docs.length > 0 && <Badge variant="secondary" className="gap-1"><FileTextIcon className="size-3" /> {docs.length} doc{docs.length > 1 ? "s" : ""}</Badge>}
                  </div>
                </div>
                <CardContent className="flex flex-col gap-4 p-5">
                  <dl className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Questions · ~700 tokens each</dt>
                      <dd className="tabular-nums">~{(questionCount * 700).toLocaleString()}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{hasGroundingDoc ? "Grounded-source overhead" : "Base overhead"}</dt>
                      <dd className="tabular-nums">~{(hasGroundingDoc ? 6000 : 1200).toLocaleString()}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Total estimate</dt>
                      <dd className="font-semibold tabular-nums">~{estimate.toLocaleString()} tokens</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Wallet hold to start (3×)</dt>
                      <dd className="tabular-nums">{formatTokens(reserve)} tokens</dd>
                    </div>
                  </dl>
                  <Separator />
                  <p className="text-muted-foreground text-xs leading-relaxed">Final billing uses actual Gemini usage. Start generation from the <strong className="text-foreground">Review step</strong> — nothing runs automatically. Cost scales with questions + grounded docs.</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Your wallet needs <strong className="text-foreground">{formatTokens(reserve)} tokens</strong> free to start — a
                    hold that covers retries. Anything unused is never charged.
                  </p>
                  {step !== STEPS.length - 1 && !generating && (
                    <p className="text-center text-xs text-muted-foreground">Generation unlocks on the Review step.</p>
                  )}

                  {/* Premium staged loader */}
                  <AnimatePresence>
                    {generating && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="rounded-2xl border bg-card p-4 shadow-card">
                          <div className="flex items-center justify-between">
                            <p className="flex items-center gap-2 text-sm font-semibold"><SparklesIcon className="size-4 text-primary" /> Generating exam</p>
                            <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold tabular-nums text-primary-foreground shadow-glow">{Math.round(genPct)}%</span>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                            <motion.div className="bg-brand h-full rounded-full" animate={{ width: `${genPct}%` }} transition={{ duration: 0.3 }} />
                          </div>
                          <div className="mt-3 grid gap-2">
                            {GEN_STAGES.map((s, i) => {
                              const active = i === genStage;
                              const done = genPct >= s.pct;
                              const past = i < genStage;
                              return (
                                <div key={s.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${active ? "border-primary/30 bg-primary/5" : past || done ? "border-success/20 bg-success/5" : "border-border bg-muted/20"}`}>
                                  <span className={`grid size-6 place-items-center rounded-full border text-[11px] font-bold ${active ? "border-primary bg-primary text-primary-foreground animate-pulse" : past || done ? "border-success bg-success text-white" : "border-border bg-muted text-muted-foreground"}`}>
                                    {past || done ? <CheckCircle2Icon className="size-3.5" /> : <s.icon className="size-3.5" />}
                                  </span>
                                  <span className={`flex-1 text-sm ${active ? "font-medium text-primary" : past || done ? "text-success" : "text-muted-foreground"}`}>{s.label}</span>
                                  {active && <Loader2Icon className="size-3.5 animate-spin text-primary" />}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-muted-foreground mt-3 text-center text-[11px]">Gemini is drafting questions calibrated to your level — don’t close this tab.</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* After generation — premium preview full-width */}
      <AnimatePresence>
        {result && !generating && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="shadow-lifted overflow-hidden rounded-2xl border bg-card">
            <div className="bg-brand relative overflow-hidden p-6 text-primary-foreground">
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-15" style={{ backgroundImage: "radial-gradient(28rem 14rem at 12% 0%, rgba(255,255,255,.9), transparent 60%)" }} />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur"><CheckCircle2Icon className="size-3.5" /> Generated successfully</p>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{result.title}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className="bg-white/15 text-white backdrop-blur border-white/20 gap-1"><FileQuestionIcon className="size-3" /> {result.questions} questions</Badge>
                    <Badge className="bg-white/15 text-white backdrop-blur border-white/20 gap-1"><ClockIcon className="size-3" /> {result.durationMinutes} min</Badge>
                    <Badge className="bg-white/15 text-white backdrop-blur border-white/20 gap-1"><EyeIcon className="size-3" /> {SUBJECT_LABELS[result.subject] ?? result.subject} · {DIFFICULTY_LABELS[result.difficulty]}</Badge>
                    <Badge className="bg-white text-primary shadow-glow gap-1">{formatUsd(tokensToUsd(result.tokensUsed))} · {result.tokensUsed.toLocaleString()} tokens</Badge>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {/* Review, then assign — the primary path out of a fresh generation.
                      This used to be an "Assign" button carrying `?assign=<id>`, a
                      deep link the library never read: it opened the table with no
                      dialog. The review screen is where assignment now lives, and it
                      is reachable by a route that exists. */}
                  <Button variant="secondary" className="rounded-xl bg-white text-primary hover:bg-white/90 shadow-glow" onClick={() => router.push(`/admin/exams/${result.examId}/review`)}><ClipboardCheckIcon className="size-4" /> Review &amp; assign</Button>
                  <Button variant="outline" className="rounded-xl border-white/30 bg-white/10 text-white backdrop-blur hover:bg-white/20" onClick={() => router.push("/admin/exams")}><EyeIcon className="size-4" /> Open in library</Button>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><SparklesIcon className="size-4 text-primary" /> Exam preview</h3>
                <div className="flex items-center gap-2">
                  {previewQuestions && previewQuestions.length > 0 && result.questions > previewQuestions.length && (
                    <Badge variant="secondary" className="tabular-nums">Showing {previewQuestions.length} of {result.questions}</Badge>
                  )}
                  <Badge variant="outline" className="gap-1"><LockIcon className="size-3" /> Draft · not yet assigned</Badge>
                </div>
              </div>

              {previewQuestions && previewQuestions.length > 0 ? (
                <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
                  <ol className="divide-y">
                    {previewQuestions.map((q, idx) => (
                      <PreviewQuestionRow key={q.id} q={q} index={idx} />
                    ))}
                  </ol>
                  {result.questions > previewQuestions.length && (
                    <p className="border-t bg-muted/20 px-4 py-2.5 text-center text-xs text-muted-foreground">Showing {previewQuestions.length} of {result.questions} — review to see and edit every question.</p>
                  )}
                </div>
              ) : previewFailed ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-center dark:border-amber-900/30 dark:bg-amber-950/20">
                  <p className="text-sm text-amber-800 dark:text-amber-200">Preview could not be loaded — exam was generated successfully. Open in library to view all questions.</p>
                </div>
              ) : (
                <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
                  <ol className="divide-y">
                    {Array.from({ length: Math.min(3, result.questions) }).map((_, i) => (
                      <li key={i} className="flex gap-3.5 p-4 sm:gap-4 sm:p-5">
                        <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                          <div className="mt-3 space-y-2">
                            <div className="h-2 w-full animate-pulse rounded bg-muted" />
                            <div className="h-2 w-5/6 animate-pulse rounded bg-muted" />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={() => router.push(`/admin/exams/${result.examId}/review`)} className="shadow-glow rounded-xl"><ClipboardCheckIcon /> Review all {result.questions} questions</Button>
                <Button variant="outline" onClick={() => { setResult(null); setPreviewQuestions(null); setSourceMode(null); setDocs([]); }} className="rounded-xl">Create another</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </>)}
    </div>
  );
}

/** Clamp a query-param integer into range, falling back when absent/garbage. */
function readInt(raw: string | null, fallback: number, lo: number, hi: number): number {
  if (!raw) return fallback;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Parse the voice builder's query-param hand-off.
 *
 * Every value is untrusted: these params are user-editable in the address bar
 * and previously flowed straight into `defaultValues` behind `as` casts. An
 * out-of-range `count`/`duration`, or a subject that doesn't exist on the
 * chosen level, seeded a form that could only fail validation — with the error
 * pointing at a field the user never touched.
 */
function readVoiceParams(sp: ReadonlyURLSearchParams) {
  const level: FormValues["level"] = sp.get("level") === "primary" ? "primary" : "secondary";
  const subLevel: "o_level" | "a_level" | null =
    level === "secondary" ? (sp.get("sublevel") === "a_level" ? "a_level" : "o_level") : null;

  const allowedSubjects = (
    level === "primary"
      ? COUNTRY_CURRICULA.UG.primary
      : SECONDARY_SUBJECTS_BY_SUB_LEVEL[subLevel ?? "o_level"]
  ) as readonly string[];
  const requestedSubject = sp.get("subject");
  const subject = (
    requestedSubject && allowedSubjects.includes(requestedSubject)
      ? requestedSubject
      : (allowedSubjects.includes("mathematics") ? "mathematics" : allowedSubjects[0])
  ) as FormValues["subject"];

  const allowedClasses: readonly number[] = classLevelOptions(level, subLevel ?? "o_level").map(
    (o) => o.value,
  );
  const requestedClass = Number(sp.get("classLevel"));
  const classLevel = allowedClasses.includes(requestedClass)
    ? requestedClass
    : level === "primary" || subLevel === "a_level"
      ? 5
      : 2;

  const requestedDifficulty = sp.get("difficulty");
  const difficulty = (
    (DIFFICULTIES as readonly string[]).includes(requestedDifficulty ?? "")
      ? requestedDifficulty
      : "medium"
  ) as FormValues["difficulty"];

  const requestedTypes = sp
    .get("types")
    ?.split(",")
    .filter((t) => (QUESTION_TYPES as readonly string[]).includes(t));
  const questionTypes = (
    requestedTypes?.length ? requestedTypes : ["multiple_choice", "short_answer"]
  ) as FormValues["questionTypes"];

  // Only offer a subsidiary the chosen subject actually has.
  const subsidiaryOptions =
    SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES]?.options as
      | readonly string[]
      | undefined;
  const requestedSubsidiary = sp.get("subsidiary");
  const subsidiary =
    requestedSubsidiary && subsidiaryOptions?.includes(requestedSubsidiary)
      ? requestedSubsidiary
      : null;

  // Source mode hand-off: `?mode=grounded` skips the picker, `?mode=pure_ai`
  // goes straight to the AI wizard, anything else (including absent) shows the
  // mode picker so the admin makes an explicit choice.
  const rawMode = sp.get("mode");
  const mode: SourceMode =
    rawMode === "pure_ai"
      ? "pure_ai"
      : rawMode === "grounded" || rawMode === "document_grounded"
        ? "document_grounded"
        : null;

  return {
    level,
    subLevel,
    subject,
    classLevel,
    topic: (sp.get("topic") ?? "").slice(0, 200),
    subsidiary,
    difficulty,
    durationMinutes: readInt(sp.get("duration"), 45, EXAM_DURATION_MIN, EXAM_DURATION_MAX),
    questionCount: readInt(sp.get("count"), 20, EXAM_QUESTIONS_MIN, EXAM_QUESTIONS_MAX),
    questionTypes,
    mode,
  };
}
