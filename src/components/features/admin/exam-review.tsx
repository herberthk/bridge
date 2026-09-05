"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  FilterIcon,
  LayersIcon,
  LightbulbIcon,
  PencilIcon,
  SparklesIcon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";

import { saveQuestionsAction, setApprovalAction } from "@/app/admin/actions";
import type { ReviewWriteState } from "@/app/admin/actions";
import { AssignExamDialog } from "@/components/features/admin/assign-exam-dialog";
import { QuestionEditor } from "@/components/features/admin/question-editor";
import { QuestionVisualView } from "@/components/features/exam/question-visual";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPE_LABELS, SUBJECT_LABELS } from "@/lib/constants";
import type { Subject } from "@/lib/constants";
import { summarizeQuestion } from "@/lib/exam/latex";
import { FIELD_LABELS, readReview, reviewProgress } from "@/lib/exam/review";
import type { EditableField } from "@/lib/exam/review";
import {
  REVISION_BATCH_MAX,
  REVISION_NOTE_MAX,
  REVISION_NOTE_MIN,
} from "@/lib/schemas/exam-review";
import type { QuestionPatchInput } from "@/lib/schemas/exam-review";
import type { SerializedWithId } from "@/lib/serialize";
import type { ExamDoc, ExamReview, Question, UserDoc } from "@/types/firestore";

/** Default batch size for review pagination — set to 7 to prevent vertical clipping */
const BATCH_SIZE = 7;

/** Helpful one-click quick revision prompts for admins */
const QUICK_REVISION_PROMPTS = [
  "Make distractors less obvious",
  "Simplify language for grade level",
  "Fix math / LaTeX formulas",
  "Add a clearer worked example",
  "Increase difficulty level",
  "Clarify explanation and hint",
];

/** What `POST /api/exams/[examId]/revise` returns. Mirrors `ReviseQuestionsResult`. */
interface ReviseResponse {
  ok?: true;
  error?: string;
  proposals?: {
    questionId: string;
    number: number;
    instruction: string;
    changeNote: string | null;
    question: Question;
    changed: EditableField[];
  }[];
  skipped?: { questionId: string; reason: string }[];
  tokensUsed?: number;
  warnings?: string[];
}

type Proposal = NonNullable<ReviseResponse["proposals"]>[number];

export interface BatchInfo {
  index: number;
  label: string;
  fullLabel: string;
  startIndex: number;
  endIndex: number;
  questionCount: number;
  questions: Question[];
  approvedCount: number;
  pendingCount: number;
  isComplete: boolean;
}

/**
 * Review every question in a generated exam, then assign it.
 *
 * Master–detail rather than a long scroll of sixty cards, for a reason that is
 * mostly about maths: every question can carry KaTeX, a chart and a worked example,
 * and mounting all of that at once costs seconds on the mid-range Android laptops
 * this is used on. Rendering one question at a time keeps the whole screen to a
 * single question's worth of work, and the rail summaries are plain text
 * (`summarizeQuestion`) so the list itself renders no maths at all.
 */
export function ExamReviewWorkspace({
  exam,
  students,
  assignedStudentIds = [],
  basePath = "/admin",
}: {
  exam: SerializedWithId<ExamDoc>;
  students: SerializedWithId<UserDoc>[];
  assignedStudentIds?: string[];
  basePath?: string;
}) {
  /**
   * Local, and initialised from props exactly once.
   *
   * Every write returns the stored questions and review state, so this is the
   * newest version in the room — re-syncing from props on each `revalidatePath`
   * would throw away an approval the reviewer made a moment ago in favour of a
   * server render that started before it.
   */
  const [questions, setQuestions] = useState<Question[]>(exam.questions);
  const [review, setReview] = useState<ExamReview>(() => readReview(exam.review));
  const [selectedId, setSelectedId] = useState<string | null>(
    () => exam.questions[0]?.id ?? null,
  );
  /** Per-question instruction drafts, keyed by question id. */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  /** Ids with a revision call in flight. */
  const [revising, setRevising] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [pending, startWrite] = useTransition();

  // Batching and view state (Dynamic for up to 60 questions with 7/batch)
  const [activeBatchIndex, setActiveBatchIndex] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"batch" | "all">("batch");
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "flagged">("all");

  const progress = useMemo(() => reviewProgress(questions, review), [questions, review]);
  const approvedSet = useMemo(() => new Set(review.approvedIds), [review.approvedIds]);

  /** Plain-text rail labels, recomputed only when a question actually changes. */
  const summaries = useMemo(
    () => Object.fromEntries(questions.map((q) => [q.id, summarizeQuestion(q.prompt, 90)])),
    [questions],
  );

  const selectedIndex = useMemo(
    () => questions.findIndex((q) => q.id === selectedId),
    [questions, selectedId],
  );

  const selected = useMemo(
    () => (selectedIndex >= 0 ? questions[selectedIndex] : null),
    [questions, selectedIndex],
  );

  /** Calculate all batches dynamically for any question count (up to 60 questions) */
  const batches = useMemo<BatchInfo[]>(() => {
    if (questions.length === 0) return [];
    const result: BatchInfo[] = [];
    const total = questions.length;
    const count = Math.ceil(total / BATCH_SIZE);
    for (let i = 0; i < count; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, total) - 1;
      const batchQuestions = questions.slice(start, end + 1);
      const approvedCount = batchQuestions.filter((q) => approvedSet.has(q.id)).length;
      const pendingCount = batchQuestions.length - approvedCount;
      result.push({
        index: i,
        label: `Q${start + 1}–${end + 1}`,
        fullLabel: `Batch ${i + 1} (Q${start + 1}–Q${end + 1})`,
        startIndex: start,
        endIndex: end,
        questionCount: batchQuestions.length,
        questions: batchQuestions,
        approvedCount,
        pendingCount,
        isComplete: pendingCount === 0 && batchQuestions.length > 0,
      });
    }
    return result;
  }, [questions, approvedSet]);

  /** Current batch for the selected question */
  const currentBatch = useMemo(() => {
    if (batches.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(activeBatchIndex, batches.length - 1));
    return batches[safeIdx] ?? batches[0];
  }, [batches, activeBatchIndex]);

  /** Synchronize selected question and active batch */
  const selectQuestion = useCallback(
    (id: string) => {
      setSelectedId(id);
      const idx = questions.findIndex((q) => q.id === id);
      if (idx >= 0) {
        const targetBatch = Math.floor(idx / BATCH_SIZE);
        setActiveBatchIndex(targetBatch);
      }
    },
    [questions],
  );

  /** Questions with a note long enough for the server to accept. */
  const flagged = useMemo(
    () =>
      Object.entries(notes)
        .filter(([, note]) => note.trim().length >= REVISION_NOTE_MIN)
        .map(([id]) => id),
    [notes],
  );

  const applyWrite = useCallback((result: ReviewWriteState, okMessage: string) => {
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    // `setApprovalAction` changes no content and returns no questions, so an empty
    // array means "unchanged", not "the exam is now empty".
    if (result.questions.length > 0) setQuestions(result.questions);
    setReview(result.review);
    toast.success(okMessage);
    return true;
  }, []);

  const approve = useCallback(
    (ids: string[], approved: boolean) => {
      if (ids.length === 0) return;
      startWrite(async () => {
        const result = await setApprovalAction({
          examId: exam.id,
          questionIds: ids,
          approved,
        });
        applyWrite(
          result,
          approved
            ? ids.length === 1
              ? "Question approved"
              : `${ids.length} questions approved`
            : "Reopened for review",
        );
      });
    },
    [applyWrite, exam.id],
  );

  /** Move to next question or unapproved question */
  const goToPrevious = useCallback(() => {
    if (selectedIndex > 0) {
      const prevQ = questions[selectedIndex - 1];
      if (prevQ) selectQuestion(prevQ.id);
    }
  }, [selectedIndex, questions, selectQuestion]);

  const goToNext = useCallback(() => {
    if (selectedIndex < questions.length - 1) {
      const nextQ = questions[selectedIndex + 1];
      if (nextQ) selectQuestion(nextQ.id);
    }
  }, [selectedIndex, questions, selectQuestion]);

  const approveAndAdvance = useCallback(
    (id: string) => {
      approve([id], true);
      const curIdx = questions.findIndex((q) => q.id === id);
      // Try finding the next unapproved question in remaining list
      const nextUnapproved = questions
        .slice(curIdx + 1)
        .find((q) => !approvedSet.has(q.id) && q.id !== id);
      if (nextUnapproved) {
        selectQuestion(nextUnapproved.id);
      } else {
        // Look for any unapproved in the whole exam
        const anyUnapproved = questions.find((q) => !approvedSet.has(q.id) && q.id !== id);
        if (anyUnapproved) {
          selectQuestion(anyUnapproved.id);
        } else if (curIdx < questions.length - 1) {
          selectQuestion(questions[curIdx + 1].id);
        }
      }
    },
    [approve, questions, approvedSet, selectQuestion],
  );

  /** Switch active batch and select its first question if current question is outside */
  const switchBatch = useCallback(
    (batchIdx: number) => {
      if (batchIdx < 0 || batchIdx >= batches.length) return;
      setActiveBatchIndex(batchIdx);
      const batch = batches[batchIdx];
      if (batch && batch.questions.length > 0) {
        if (selectedIndex < batch.startIndex || selectedIndex > batch.endIndex) {
          setSelectedId(batch.questions[0].id);
        }
      }
    },
    [batches, selectedIndex],
  );

  /** Approve all pending questions in the current batch */
  const approveCurrentBatch = useCallback(() => {
    if (!currentBatch) return;
    const pendingInBatch = currentBatch.questions
      .filter((q) => !approvedSet.has(q.id))
      .map((q) => q.id);
    if (pendingInBatch.length > 0) {
      approve(pendingInBatch, true);
    }
  }, [currentBatch, approvedSet, approve]);

  /**
   * One write path for both an accepted AI proposal and a hand edit.
   */
  const saveQuestion = useCallback(
    (patch: QuestionPatchInput, onDone?: () => void) =>
      startWrite(async () => {
        const result = await saveQuestionsAction({
          examId: exam.id,
          questions: [patch],
          approve: true,
        });
        if (applyWrite(result, "Saved and approved")) onDone?.();
      }),
    [applyWrite, exam.id],
  );

  /** Ask the model to revise the given questions, using their drafted notes. */
  const revise = useCallback(
    async (ids: string[]) => {
      const items = ids
        .map((id) => ({ questionId: id, instruction: (notes[id] ?? "").trim() }))
        .filter((i) => i.instruction.length >= REVISION_NOTE_MIN);
      if (items.length === 0) {
        toast.error("Say what should change first.");
        return;
      }
      setRevising((prev) => [...new Set([...prev, ...items.map((i) => i.questionId)])]);
      try {
        const res = await fetch(`/api/exams/${exam.id}/revise`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const data = (await res.json().catch(() => null)) as ReviseResponse | null;
        if (!res.ok || !data?.ok) {
          toast.error(data?.error ?? "The revision failed. Try again.");
          return;
        }
        const incoming = data.proposals ?? [];
        setProposals((prev) => {
          const next = { ...prev };
          for (const p of incoming) next[p.questionId] = p;
          return next;
        });
        setSkipped((prev) => {
          const next = { ...prev };
          for (const p of incoming) delete next[p.questionId];
          for (const s of data.skipped ?? []) next[s.questionId] = s.reason;
          return next;
        });
        for (const w of data.warnings ?? []) toast.warning(w);
        if (incoming.length === 0) {
          toast.error("The AI returned no changes. Try a more specific instruction.");
        } else {
          toast.success(
            incoming.length === 1
              ? "Revision ready — compare and accept"
              : `${incoming.length} revisions ready`,
          );
          if (!incoming.some((p) => p.questionId === selectedId)) {
            selectQuestion(incoming[0]!.questionId);
          }
        }
      } catch (err) {
        console.error("[exam-review] revise failed", err);
        toast.error("Could not reach the server. Check your connection.");
      } finally {
        setRevising((prev) => prev.filter((id) => !ids.includes(id)));
      }
    },
    [exam.id, notes, selectedId, selectQuestion],
  );

  const acceptProposal = useCallback(
    (proposal: Proposal) => {
      saveQuestion(proposal.question, () => {
        setProposals((prev) => {
          const next = { ...prev };
          delete next[proposal.questionId];
          return next;
        });
        setNotes((prev) => ({ ...prev, [proposal.questionId]: "" }));
        goToNext();
      });
    },
    [saveQuestion, goToNext],
  );

  const discardProposal = useCallback((id: string) => {
    setProposals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Filter questions displayed in the rail
  const displayedQuestions = useMemo(() => {
    let list =
      viewMode === "batch" && currentBatch ? currentBatch.questions : questions;

    if (filterMode === "pending") {
      list = list.filter((q) => !approvedSet.has(q.id));
    } else if (filterMode === "flagged") {
      list = list.filter(
        (q) =>
          (notes[q.id] ?? "").trim().length >= REVISION_NOTE_MIN || Boolean(proposals[q.id]),
      );
    }
    return list;
  }, [viewMode, currentBatch, questions, filterMode, approvedSet, notes, proposals]);

  const levelLabel =
    exam.params.level === "primary"
      ? `P${exam.params.classLevel}`
      : `S${exam.params.classLevel} ${exam.params.secondarySubLevel === "a_level" ? "A level" : "O level"}`;
  const locked = exam.status !== "draft";

  return (
    <div className="flex flex-col gap-5">
      {/* ── Premium Exam Header ── */}
      <div className="relative overflow-hidden rounded-2xl border bg-card/90 p-5 shadow-sm backdrop-blur-md transition-all sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary text-xs">
                {SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {levelLabel}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {questions.length} questions
              </Badge>
              <Badge variant="outline" className="text-xs">
                {exam.params.durationMinutes} min
              </Badge>
              {locked && (
                <Badge variant="destructive" className="text-xs">
                  {exam.status}
                </Badge>
              )}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {exam.title}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {progress.pendingIds.length > 0 && !locked && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => approve(progress.pendingIds, true)}
                className="hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400"
              >
                <CheckIcon data-icon="inline-start" className="size-4 text-emerald-600" />
                Approve all ({progress.pendingIds.length} remaining)
              </Button>
            )}
            <AssignExamDialog
              exam={{ ...exam, questions, review }}
              students={students}
              assignedStudentIds={assignedStudentIds}
              variant="default"
              label={progress.complete ? "Assign to students" : "Assign exam"}
              open={assignOpen}
              onOpenChange={setAssignOpen}
              basePath={basePath}
            />
          </div>
        </div>

        {/* Global Review Progress */}
        <div className="mt-4 flex flex-col gap-2 border-t pt-4">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="flex items-center gap-1.5 text-foreground">
              <span className="inline-block size-2 rounded-full bg-emerald-500" />
              {progress.approved} of {progress.total} questions signed off
            </span>
            <span className="text-muted-foreground tabular-nums">
              {review.revisedCount > 0 && (
                <span className="text-primary font-normal">{review.revisedCount} revised · </span>
              )}
              {progress.percent}% completed
            </span>
          </div>
          <Progress
            value={progress.percent}
            className={`h-2.5 rounded-full ${
              progress.complete ? "[--primary:var(--color-emerald-600)]" : "[--primary:var(--color-primary)]"
            }`}
          />
        </div>

        {locked && (
          <p className="text-muted-foreground mt-3 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            This exam is {exam.status}. Its questions are locked to protect student attempt integrity.
          </p>
        )}
      </div>

      {/* ── Main Review Layout: Rail (Batch Navigator) + Detail Card ── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* ── Left Rail: Batches & Questions ── */}
        <div className="shadow-card flex h-[calc(100vh-2rem)] max-h-[850px] min-h-[500px] flex-col overflow-hidden rounded-2xl border bg-card/95 backdrop-blur-sm lg:sticky lg:top-4">
          {/* Rail Header & Batch Switcher (Fixed Top) */}
          <div className="flex shrink-0 flex-col gap-2.5 border-b bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <LayersIcon className="size-4 text-primary" />
                Questions ({questions.length})
              </span>
              <div className="flex items-center gap-1">
                {flagged.length > 1 && !locked && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={revising.length > 0}
                    onClick={() => revise(flagged.slice(0, REVISION_BATCH_MAX))}
                    className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                  >
                    <SparklesIcon data-icon="inline-start" className="size-3" />
                    Revise {Math.min(flagged.length, REVISION_BATCH_MAX)}
                  </Button>
                )}
                {/* View Mode Toggle: Batched (7) vs All */}
                <button
                  type="button"
                  onClick={() => setViewMode((m) => (m === "batch" ? "all" : "batch"))}
                  className="rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  title="Toggle between batch pagination (7/batch) and full question list"
                >
                  {viewMode === "batch" ? "Batched (7)" : "Show All"}
                </button>
              </div>
            </div>

            {/* Batch Navigator with Previous/Next Buttons (When in Batch View) */}
            {viewMode === "batch" && batches.length > 1 && (
              <div className="flex flex-col gap-2 rounded-xl border bg-card/70 p-2.5 shadow-xs">
                {/* Top Row: Prev Batch Button, Current Batch Indicator, Next Batch Button */}
                <div className="flex items-center justify-between gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={activeBatchIndex === 0}
                    onClick={() => switchBatch(activeBatchIndex - 1)}
                    className="h-7 gap-1 px-2 text-xs font-medium"
                    title="Go to previous batch"
                    aria-label="Previous batch"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                    <span>Prev</span>
                  </Button>

                  <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground">
                        Batch {activeBatchIndex + 1} of {batches.length}
                      </span>
                      {currentBatch?.isComplete ? (
                        <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-500" />
                      ) : (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                          {currentBatch?.label}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {currentBatch?.approvedCount} of {currentBatch?.questionCount} reviewed
                    </span>
                  </div>

                  <Button
                    size="xs"
                    variant="outline"
                    disabled={activeBatchIndex >= batches.length - 1}
                    onClick={() => switchBatch(activeBatchIndex + 1)}
                    className="h-7 gap-1 px-2 text-xs font-medium"
                    title="Go to next batch"
                    aria-label="Next batch"
                  >
                    <span>Next</span>
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </div>

                {/* Batch Jump Selector Pills (Cleanly Wrapped) */}
                <div className="flex flex-wrap items-center justify-center gap-1 border-t border-border/50 pt-1.5">
                  {batches.map((b) => {
                    const isActive = b.index === activeBatchIndex;
                    return (
                      <button
                        key={b.index}
                        type="button"
                        onClick={() => switchBatch(b.index)}
                        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-all ${
                          isActive
                            ? "bg-primary text-primary-foreground shadow-xs font-semibold ring-1 ring-primary/40"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        title={`${b.fullLabel} (${b.approvedCount}/${b.questionCount} reviewed)`}
                      >
                        <span>{b.label}</span>
                        {b.isComplete && (
                          <span className={`text-[10px] ${isActive ? "text-primary-foreground" : "text-emerald-600"}`}>
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Batch Action Bar */}
                {currentBatch && currentBatch.pendingCount > 0 && !locked && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={approveCurrentBatch}
                    className="w-full justify-center border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400 py-1"
                  >
                    <CheckIcon data-icon="inline-start" className="size-3.5" />
                    Approve batch {activeBatchIndex + 1} ({currentBatch.pendingCount} pending)
                  </Button>
                )}
              </div>
            )}

            {/* Filter pills: All / Pending / Flagged */}
            <div className="flex items-center gap-1 pt-0.5">
              <FilterIcon className="size-3 text-muted-foreground mr-1" />
              {(["all", "pending", "flagged"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilterMode(f)}
                  className={`rounded px-2 py-0.5 text-[11px] capitalize transition ${
                    filterMode === f
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "flagged" ? `Flagged (${flagged.length})` : f}
                </button>
              ))}
            </div>
          </div>

          {/* Question List (Scrollable Area) */}
          <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
            {displayedQuestions.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No questions match the active filter.
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5 p-2 pb-8">
                {displayedQuestions.map((q) => {
                  const isApproved = approvedSet.has(q.id);
                  const hasProposal = Boolean(proposals[q.id]);
                  const isFlagged = (notes[q.id] ?? "").trim().length >= REVISION_NOTE_MIN;
                  const isSelected = q.id === selectedId;
                  const questionNum = questions.findIndex((item) => item.id === q.id) + 1;

                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        onClick={() => selectQuestion(q.id)}
                        aria-current={isSelected}
                        className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all ${
                          isSelected
                            ? "bg-primary/10 border border-primary/40 shadow-xs ring-1 ring-primary/20"
                            : "hover:bg-accent/60 border border-transparent"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          {isApproved ? (
                            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                          ) : (
                            <CircleDashedIcon className="size-4 text-muted-foreground/60" />
                          )}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-semibold tabular-nums ${
                                isSelected ? "text-primary" : "text-foreground"
                              }`}
                            >
                              Q{questionNum}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase font-mono">
                              {q.type === "multiple_choice"
                                ? "MCQ"
                                : q.type === "true_false"
                                  ? "T/F"
                                  : q.type.replace(/_/g, " ")}
                            </span>
                            {hasProposal && (
                              <Badge
                                variant="outline"
                                className="h-4 border-primary/40 bg-primary/15 px-1 text-[10px] text-primary font-medium"
                              >
                                revision
                              </Badge>
                            )}
                            {!hasProposal && isFlagged && (
                              <Badge
                                variant="outline"
                                className="h-4 border-amber-500/40 bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-400 font-medium"
                              >
                                noted
                              </Badge>
                            )}
                            {revising.includes(q.id) && <Spinner className="size-3" />}
                          </span>
                          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {summaries[q.id]}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>

          {/* Rail Footer with Previous/Next Batch Navigation (Fixed Bottom) */}
          {viewMode === "batch" && batches.length > 1 && (
            <div className="flex shrink-0 items-center justify-between border-t bg-muted/20 px-3 py-2 text-xs">
              <Button
                size="xs"
                variant="ghost"
                disabled={activeBatchIndex === 0}
                onClick={() => switchBatch(activeBatchIndex - 1)}
                className="gap-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeftIcon className="size-3.5" />
                Previous Batch
              </Button>
              <span className="text-[11px] text-muted-foreground font-mono">
                {activeBatchIndex + 1}/{batches.length}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={activeBatchIndex >= batches.length - 1}
                onClick={() => switchBatch(activeBatchIndex + 1)}
                className="gap-1 text-muted-foreground hover:text-foreground"
              >
                Next Batch
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* ── Right Column: Active Question Detail & Actions ── */}
        <div className="min-w-0">
          {!selected ? (
            <div className="shadow-card text-muted-foreground rounded-2xl border bg-card p-12 text-center text-sm">
              This exam has no questions to review.
            </div>
          ) : (
            <QuestionDetail
              key={selected.id}
              question={selected}
              number={selectedIndex + 1}
              totalQuestions={questions.length}
              currentBatchIndex={currentBatch?.index ?? 0}
              totalBatches={batches.length}
              approved={approvedSet.has(selected.id)}
              locked={locked}
              pending={pending}
              revising={revising.includes(selected.id)}
              note={notes[selected.id] ?? ""}
              onNoteChange={(value) =>
                setNotes((prev) => ({ ...prev, [selected.id]: value }))
              }
              proposal={proposals[selected.id] ?? null}
              skippedReason={skipped[selected.id] ?? null}
              editing={editingId === selected.id}
              onEdit={() => setEditingId(selected.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(next) => saveQuestion(next, () => setEditingId(null))}
              onApprove={() => approveAndAdvance(selected.id)}
              onReopen={() => approve([selected.id], false)}
              onRevise={() => revise([selected.id])}
              onAccept={(p) => acceptProposal(p)}
              onDiscard={() => discardProposal(selected.id)}
              onPrevious={goToPrevious}
              onNext={goToNext}
              hasPrevious={selectedIndex > 0}
              hasNext={selectedIndex < questions.length - 1}
              isAllComplete={progress.complete}
              onAssignClick={() => setAssignOpen(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Detailed Question View & Action Workspace ── */

function QuestionDetail({
  question,
  number,
  totalQuestions,
  currentBatchIndex,
  totalBatches,
  approved,
  locked,
  pending,
  revising,
  note,
  onNoteChange,
  proposal,
  skippedReason,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onApprove,
  onReopen,
  onRevise,
  onAccept,
  onDiscard,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  isAllComplete,
  onAssignClick,
}: {
  question: Question;
  number: number;
  totalQuestions: number;
  currentBatchIndex: number;
  totalBatches: number;
  approved: boolean;
  locked: boolean;
  pending: boolean;
  revising: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  proposal: Proposal | null;
  skippedReason: string | null;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (patch: QuestionPatchInput) => void;
  onApprove: () => void;
  onReopen: () => void;
  onRevise: () => void;
  onAccept: (proposal: Proposal) => void;
  onDiscard: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  isAllComplete: boolean;
  onAssignClick?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* ── Main Question Card ── */}
      <div className="shadow-card flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:p-6 transition-all">
        {/* Question Header & Quick Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="px-2.5 py-1 text-sm font-semibold tabular-nums">
              Question {number} of {totalQuestions}
            </Badge>
            {totalBatches > 1 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Batch {currentBatchIndex + 1}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {QUESTION_TYPE_LABELS[question.type] ?? question.type.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-xs tabular-nums">
              {question.points} mark{question.points === 1 ? "" : "s"}
            </Badge>
            {approved ? (
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-medium"
              >
                <CheckIcon className="size-3 mr-1" /> Approved
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
                Pending review
              </Badge>
            )}
          </div>

          {/* Quick Header Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Quick Prev/Next arrows in header */}
            <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!hasPrevious}
                onClick={onPrevious}
                title="Previous Question"
                aria-label="Previous question"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <span className="px-1 text-[11px] font-mono text-muted-foreground">
                {number}/{totalQuestions}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!hasNext}
                onClick={onNext}
                title="Next Question"
                aria-label="Next question"
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>

            {!locked && (
              <>
                {!editing && (
                  <Button size="sm" variant="ghost" onClick={onEdit} className="text-xs gap-1">
                    <PencilIcon className="size-3.5" />
                    Edit
                  </Button>
                )}
                {approved ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={onReopen}
                    className="text-xs gap-1"
                  >
                    <Undo2Icon className="size-3.5" />
                    Reopen
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={onApprove}
                    className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckIcon className="size-3.5" />
                    Approve
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <Separator />

        {/* Content Body or Inline Editor */}
        {editing ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                Editing Question {number}
              </span>
            </div>
            <QuestionEditor
              question={question}
              pending={pending}
              onCancel={onCancelEdit}
              onSave={onSave}
            />
          </div>
        ) : (
          <QuestionBody question={question} />
        )}
      </div>

      {/* ── AI Revision Workspace ── */}
      {!locked && !editing && (
        <div className="shadow-card relative overflow-hidden rounded-2xl border border-primary/25 bg-card p-5 transition-all">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SparklesIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">AI Question Revision</p>
              <p className="text-muted-foreground text-xs">
                Specify changes, and the AI will generate a revised proposal. Nothing is saved until you accept.
              </p>
            </div>
          </div>

          {/* Quick Prompt Chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK_REVISION_PROMPTS.map((promptText) => (
              <button
                key={promptText}
                type="button"
                disabled={revising}
                onClick={() => {
                  onNoteChange(
                    note.trim() ? `${note.trim()}; ${promptText.toLowerCase()}` : promptText,
                  );
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <LightbulbIcon className="size-3 text-primary/70" />
                {promptText}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <Textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              maxLength={REVISION_NOTE_MAX}
              rows={3}
              placeholder="e.g. Make option C clearly incorrect, convert units from feet to metres, and add a worked example."
              disabled={revising}
              className="resize-none text-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={revising || note.trim().length < REVISION_NOTE_MIN}
                  onClick={onRevise}
                  className="gap-1.5"
                >
                  {revising ? <Spinner className="size-4" /> : <SparklesIcon className="size-4" />}
                  {revising ? "Generating Revision…" : proposal ? "Re-revise Question" : "Revise with AI"}
                </Button>
                {proposal && (
                  <span className="text-xs text-primary font-medium">
                    ✓ Proposal ready below
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-xs tabular-nums">
                {note.trim().length}/{REVISION_NOTE_MAX} characters
              </span>
            </div>
          </div>

          {skippedReason && !proposal && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              {skippedReason}
            </p>
          )}
        </div>
      )}

      {/* ── Proposed Revision Card (Side-by-side Diff) ── */}
      {proposal && !editing && (
        <ProposalCard
          proposal={proposal}
          before={question}
          pending={pending}
          locked={locked}
          onAccept={() => onAccept(proposal)}
          onDiscard={onDiscard}
        />
      )}

      {/* ── Bottom Dock Navigation ── */}
      <div className="shadow-card sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-lg backdrop-blur-md">
        {/* Previous Button */}
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious}
          onClick={onPrevious}
          className="gap-1.5 font-medium"
        >
          <ArrowLeftIcon className="size-4" />
          Previous (Q{Math.max(1, number - 1)})
        </Button>

        {/* Center Progress / Status */}
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>
            Question <strong className="text-foreground">{number}</strong> of {totalQuestions}
          </span>
          <span>·</span>
          <span>
            {approved ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Signed off</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">Needs review</span>
            )}
          </span>
        </div>

        {/* Next / Approve & Next / Assign Button */}
        <div className="flex items-center gap-2">
          {!approved && !locked ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={onApprove}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            >
              <CheckIcon className="size-4" />
              Approve &amp; Next
              <ArrowRightIcon className="size-4" />
            </Button>
          ) : hasNext ? (
            <Button
              variant="default"
              size="sm"
              onClick={onNext}
              className="gap-1.5 font-medium"
            >
              Next (Q{number + 1})
              <ArrowRightIcon className="size-4" />
            </Button>
          ) : isAllComplete ? (
            <Button
              variant="default"
              size="sm"
              onClick={onAssignClick}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
            >
              <CheckCircle2Icon className="size-4" />
              Ready to Assign
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={true}
              className="gap-1.5 font-medium opacity-60"
            >
              Last Question
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Rendering a question as a student would see it, plus the answer key ── */

function QuestionBody({ question }: { question: Question }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-base leading-relaxed text-foreground">
        <Markdown>{question.prompt}</Markdown>
      </div>

      {question.visual && <QuestionVisualView visual={question.visual} />}

      {/* Multiple Choice Options */}
      {question.type === "multiple_choice" && question.options && (
        <ul className="flex flex-col gap-2">
          {question.options.map((option, i) => {
            const correct = question.correctOptionIndex === i;
            return (
              <li
                key={`${i}-${option}`}
                className={`flex items-start gap-3 rounded-xl border p-3 text-sm transition-all ${
                  correct
                    ? "border-emerald-500/50 bg-emerald-500/10 shadow-xs dark:bg-emerald-950/20"
                    : "border-border/70 bg-card/60 hover:bg-card"
                }`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    correct
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-muted text-muted-foreground font-mono"
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <Markdown className="prose-bridge">{option}</Markdown>
                </div>
                {correct && (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-bold shrink-0">
                    Correct Key
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* True / False */}
      {question.type === "true_false" && (
        <div className="flex items-center gap-3 rounded-xl border p-3 text-sm bg-muted/20">
          <span className="text-muted-foreground font-medium">Answer key:</span>
          <Badge
            variant={question.correctBool !== null ? "default" : "secondary"}
            className="text-xs font-semibold"
          >
            {question.correctBool === null ? "—" : question.correctBool ? "True" : "False"}
          </Badge>
        </div>
      )}

      {/* Acceptable Answers (Short Answer / Fill in Blank) */}
      {question.acceptableAnswers && question.acceptableAnswers.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3.5">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            Accepted answers
          </p>
          <div className="flex flex-wrap gap-1.5">
            {question.acceptableAnswers.map((a, i) => (
              <Badge key={`${i}-${a}`} variant="secondary" className="font-mono text-xs">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Matching Pairs */}
      {question.pairs && question.pairs.length > 0 && (
        <div className="overflow-hidden rounded-xl border">
          <div className="bg-muted/40 px-3.5 py-2 border-b text-xs font-semibold text-muted-foreground">
            Matching Pairs
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {question.pairs.map((p, i) => (
                <tr key={`${i}-${p.left}`} className="hover:bg-muted/10">
                  <td className="w-1/2 border-r p-3 align-top font-medium">
                    <Markdown className="prose-bridge">{p.left}</Markdown>
                  </td>
                  <td className="p-3 align-top text-muted-foreground">
                    <Markdown className="prose-bridge">{p.right}</Markdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pedagogical Prose (Hint, Explanation, Worked Example) */}
      {(question.hint || question.explanation || question.workedExample) && (
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/25 p-4">
          {question.hint && <LabelledProse label="Hint" value={question.hint} />}
          {question.explanation && (
            <LabelledProse label="Explanation" value={question.explanation} />
          )}
          {question.workedExample && (
            <LabelledProse label="Worked Example" value={question.workedExample} />
          )}
        </div>
      )}
    </div>
  );
}

function LabelledProse({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        {label}
      </p>
      <div className="text-sm text-foreground">
        <Markdown className="prose-bridge">{value}</Markdown>
      </div>
    </div>
  );
}

/* ── A proposed revision, beside what it replaces ── */

function ProposalCard({
  proposal,
  before,
  pending,
  locked,
  onAccept,
  onDiscard,
}: {
  proposal: Proposal;
  before: Question;
  pending: boolean;
  locked: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="shadow-card overflow-hidden rounded-2xl border border-primary/40 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/10 px-4 py-3">
        <SparklesIcon className="size-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Proposed AI Revision</p>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onDiscard}>
            <XIcon data-icon="inline-start" className="size-3.5" />
            Discard
          </Button>
          <Button
            size="sm"
            disabled={pending || locked}
            onClick={onAccept}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
          >
            <CheckIcon data-icon="inline-start" className="size-3.5" />
            Accept &amp; Approve
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {proposal.changeNote && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
            <span className="font-semibold text-primary">Changes made: </span>
            <span className="text-foreground">{proposal.changeNote}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {proposal.changed.map((field) => (
            <Badge key={field} variant="outline" className="border-primary/40 text-primary font-medium text-xs">
              Modified: {FIELD_LABELS[field]}
            </Badge>
          ))}
        </div>

        {/* Side by side diff */}
        {proposal.changed.map((field) => (
          <FieldDiff
            key={field}
            field={field}
            before={before}
            after={proposal.question}
          />
        ))}
      </div>
    </div>
  );
}

/** Renders one field before and after, side by side on wide screens */
function FieldDiff({
  field,
  before,
  after,
}: {
  field: EditableField;
  before: Question;
  after: Question;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {FIELD_LABELS[field]}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-destructive">
            Current
          </p>
          <FieldValueView field={field} question={before} />
        </div>
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Proposed Revision
          </p>
          <FieldValueView field={field} question={after} />
        </div>
      </div>
    </div>
  );
}

function FieldValueView({
  field,
  question,
}: {
  field: EditableField;
  question: Question;
}) {
  const empty = <p className="text-muted-foreground text-sm italic">Empty</p>;

  switch (field) {
    case "prompt":
    case "hint":
    case "explanation":
    case "workedExample": {
      const value = question[field];
      return value ? <Markdown className="prose-bridge text-sm">{value}</Markdown> : empty;
    }
    case "options": {
      if (!question.options?.length) return empty;
      return (
        <ol className="flex flex-col gap-1.5 text-sm">
          {question.options.map((o, i) => (
            <li key={`${i}-${o}`} className="flex gap-2">
              <span className="text-muted-foreground shrink-0 font-bold">
                {String.fromCharCode(65 + i)}.
              </span>
              <Markdown className="prose-bridge min-w-0">{o}</Markdown>
            </li>
          ))}
        </ol>
      );
    }
    case "correctOptionIndex": {
      const i = question.correctOptionIndex;
      if (i === null) return empty;
      return (
        <p className="text-sm font-semibold">
          {String.fromCharCode(65 + i)}
          {question.options?.[i] ? ` — ${summarizeQuestion(question.options[i], 80)}` : ""}
        </p>
      );
    }
    case "correctBool":
      return (
        <p className="text-sm font-semibold">
          {question.correctBool === null ? "—" : question.correctBool ? "True" : "False"}
        </p>
      );
    case "acceptableAnswers": {
      if (!question.acceptableAnswers?.length) return empty;
      return (
        <div className="flex flex-wrap gap-1.5">
          {question.acceptableAnswers.map((a, i) => (
            <Badge key={`${i}-${a}`} variant="secondary" className="font-mono text-xs">
              {a}
            </Badge>
          ))}
        </div>
      );
    }
    case "pairs": {
      if (!question.pairs?.length) return empty;
      return (
        <ul className="flex flex-col gap-1 text-sm">
          {question.pairs.map((p, i) => (
            <li key={`${i}-${p.left}`} className="flex gap-1.5">
              <span className="min-w-0 flex-1 truncate">{summarizeQuestion(p.left, 40)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="min-w-0 flex-1 truncate">{summarizeQuestion(p.right, 40)}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "points":
      return <p className="text-sm font-semibold tabular-nums">{question.points}</p>;
    case "visual": {
      if (!question.visual) return empty;
      return <QuestionVisualView visual={question.visual} />;
    }
    default:
      return empty;
  }
}
