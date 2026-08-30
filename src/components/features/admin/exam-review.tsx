"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CheckIcon,
  CircleDashedIcon,
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
}: {
  exam: SerializedWithId<ExamDoc>;
  students: SerializedWithId<UserDoc>[];
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
  const [pending, startWrite] = useTransition();

  const progress = useMemo(() => reviewProgress(questions, review), [questions, review]);
  const approvedSet = useMemo(() => new Set(review.approvedIds), [review.approvedIds]);
  /** Plain-text rail labels, recomputed only when a question actually changes. */
  const summaries = useMemo(
    () => Object.fromEntries(questions.map((q) => [q.id, summarizeQuestion(q.prompt, 90)])),
    [questions],
  );
  const selected = useMemo(
    () => questions.find((q) => q.id === selectedId) ?? null,
    [questions, selectedId],
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

  /** Move to the next question still awaiting sign-off, if there is one. */
  const advance = useCallback(
    (fromId: string) => {
      const next =
        questions.find((q) => !approvedSet.has(q.id) && q.id !== fromId) ?? null;
      if (next) setSelectedId(next.id);
    },
    [questions, approvedSet],
  );

  const approveAndAdvance = useCallback(
    (id: string) => {
      approve([id], true);
      advance(id);
    },
    [approve, advance],
  );

  /**
   * One write path for both an accepted AI proposal and a hand edit.
   *
   * Both are the same thing as far as the server is concerned — a patch keyed by
   * question id — and both should sign the question off, because a reviewer who has
   * just rewritten a question has by definition read it.
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
          // A fresh proposal clears whatever the last attempt said about it.
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
          // Land the reviewer on something they can act on, but never move them off
          // a question they are already looking at a proposal for.
          if (!incoming.some((p) => p.questionId === selectedId)) {
            setSelectedId(incoming[0]!.questionId);
          }
        }
      } catch (err) {
        console.error("[exam-review] revise failed", err);
        toast.error("Could not reach the server. Check your connection.");
      } finally {
        setRevising((prev) => prev.filter((id) => !ids.includes(id)));
      }
    },
    [exam.id, notes, selectedId],
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
        advance(proposal.questionId);
      });
    },
    [saveQuestion, advance],
  );

  const discardProposal = useCallback((id: string) => {
    setProposals((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const levelLabel =
    exam.params.level === "primary"
      ? `P${exam.params.classLevel}`
      : `S${exam.params.classLevel} ${exam.params.secondarySubLevel === "a_level" ? "A level" : "O level"}`;
  const locked = exam.status !== "draft";

  return (
    <div className="flex flex-col gap-4">
      {/* Header: what this exam is, how far the review has got, and the way out. */}
      <div className="shadow-card flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {exam.title}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {SUBJECT_LABELS[exam.params.subject as Subject] ?? exam.params.subject} ·{" "}
              {levelLabel} · {questions.length} questions · {exam.params.durationMinutes} min
            </p>
          </div>
          <div className="flex items-center gap-2">
            {progress.pendingIds.length > 0 && !locked && (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => approve(progress.pendingIds, true)}
              >
                <CheckIcon data-icon="inline-start" />
                Approve remaining {progress.pendingIds.length}
              </Button>
            )}
            <AssignExamDialog
              exam={{ ...exam, questions, review }}
              students={students}
              variant="default"
              label={progress.complete ? "Assign to students" : "Assign"}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {progress.approved} of {progress.total} reviewed
            </span>
            <span className="text-muted-foreground tabular-nums">
              {review.revisedCount > 0 && `${review.revisedCount} revised · `}
              {progress.percent}%
            </span>
          </div>
          <Progress
            value={progress.percent}
            className={progress.complete ? "[--primary:var(--color-emerald-600)]" : undefined}
          />
        </div>

        {locked && (
          <p className="text-muted-foreground flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            This exam is {exam.status}, so its questions can no longer be changed —
            students may already have answered them. Everything below is read-only.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
        {/* ── Rail: every question, at a glance ── */}
        <div className="shadow-card flex max-h-[70vh] flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <span className="text-sm font-medium">Questions</span>
            {flagged.length > 1 && !locked && (
              <Button
                size="xs"
                variant="outline"
                disabled={revising.length > 0}
                onClick={() => revise(flagged.slice(0, REVISION_BATCH_MAX))}
              >
                <SparklesIcon data-icon="inline-start" />
                Revise {Math.min(flagged.length, REVISION_BATCH_MAX)}
              </Button>
            )}
          </div>
          <ScrollArea className="flex-1">
            <ul className="flex flex-col p-2">
              {questions.map((q, i) => {
                const isApproved = approvedSet.has(q.id);
                const hasProposal = Boolean(proposals[q.id]);
                const isFlagged = (notes[q.id] ?? "").trim().length >= REVISION_NOTE_MIN;
                const isSelected = q.id === selectedId;
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(q.id)}
                      aria-current={isSelected}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
                        isSelected ? "bg-accent shadow-xs" : "hover:bg-accent/50"
                      }`}
                    >
                      <span className="mt-px shrink-0">
                        {isApproved ? (
                          <CheckCircle2Icon className="size-4 text-emerald-600" />
                        ) : (
                          <CircleDashedIcon className="text-muted-foreground/60 size-4" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-muted-foreground text-xs font-medium tabular-nums">
                            Q{i + 1}
                          </span>
                          {hasProposal && (
                            <Badge
                              variant="outline"
                              className="h-4 border-primary/40 bg-primary/10 px-1 text-[10px] text-primary"
                            >
                              revision
                            </Badge>
                          )}
                          {!hasProposal && isFlagged && (
                            <Badge
                              variant="outline"
                              className="h-4 border-amber-500/40 px-1 text-[10px] text-amber-700 dark:text-amber-400"
                            >
                              noted
                            </Badge>
                          )}
                          {revising.includes(q.id) && <Spinner className="size-3" />}
                        </span>
                        <span className="line-clamp-2 text-xs leading-snug">
                          {summaries[q.id]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>

        {/* ── Detail: the one question being reviewed ── */}
        <div className="min-w-0">
          {!selected ? (
            <div className="shadow-card text-muted-foreground rounded-xl border bg-card p-12 text-center text-sm">
              This exam has no questions.
            </div>
          ) : (
            <QuestionDetail
              key={selected.id}
              question={selected}
              number={questions.findIndex((q) => q.id === selected.id) + 1}
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
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── One question, read view + the three things you can do to it ── */

function QuestionDetail({
  question,
  number,
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
}: {
  question: Question;
  number: number;
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
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="shadow-card flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            Question {number}
          </Badge>
          <Badge variant="outline">
            {QUESTION_TYPE_LABELS[question.type] ?? question.type.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            {question.points} mark{question.points === 1 ? "" : "s"}
          </Badge>
          {approved && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              <CheckIcon className="size-3" /> Approved
            </Badge>
          )}
          {!locked && (
            <div className="ml-auto flex items-center gap-1.5">
              {!editing && (
                <Button size="sm" variant="ghost" onClick={onEdit}>
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              )}
              {approved ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={onReopen}>
                  <Undo2Icon data-icon="inline-start" />
                  Reopen
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={onApprove}>
                  <CheckIcon data-icon="inline-start" />
                  Approve
                </Button>
              )}
            </div>
          )}
        </div>

        <Separator />

        {editing ? (
          <QuestionEditor
            question={question}
            pending={pending}
            onCancel={onCancelEdit}
            onSave={onSave}
          />
        ) : (
          <QuestionBody question={question} />
        )}
      </div>

      {/* ── AI revision ── */}
      {!locked && !editing && (
        <div className="shadow-card flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <span className="bg-brand-soft flex size-7 items-center justify-center rounded-lg text-accent-foreground">
              <SparklesIcon className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">Ask AI to change this question</p>
              <p className="text-muted-foreground text-xs">
                Say what should change. Nothing is saved until you accept it.
              </p>
            </div>
          </div>
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            maxLength={REVISION_NOTE_MAX}
            rows={3}
            placeholder="e.g. Make option C clearly wrong, and use metres instead of feet."
            disabled={revising}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={revising || note.trim().length < REVISION_NOTE_MIN}
              onClick={onRevise}
            >
              {revising ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
              {revising ? "Revising…" : proposal ? "Try again" : "Revise question"}
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {note.trim().length}/{REVISION_NOTE_MAX}
            </span>
          </div>
          {skippedReason && !proposal && (
            <p className="text-muted-foreground rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
              {skippedReason}
            </p>
          )}
        </div>
      )}

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
    </div>
  );
}

/* ── Rendering a question as a student would see it, plus the answer key ── */

function QuestionBody({ question }: { question: Question }) {
  return (
    <div className="flex flex-col gap-4">
      <Markdown>{question.prompt}</Markdown>
      {question.visual && <QuestionVisualView visual={question.visual} />}

      {question.type === "multiple_choice" && question.options && (
        <ul className="flex flex-col gap-1.5">
          {question.options.map((option, i) => {
            const correct = question.correctOptionIndex === i;
            return (
              <li
                key={`${i}-${option}`}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-sm ${
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/10"
                    : "border-border bg-background"
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                    correct
                      ? "bg-emerald-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <Markdown className="prose-bridge min-w-0 flex-1">{option}</Markdown>
              </li>
            );
          })}
        </ul>
      )}

      {question.type === "true_false" && (
        <p className="text-sm">
          <span className="text-muted-foreground">Answer: </span>
          <span className="font-medium">
            {question.correctBool === null ? "—" : question.correctBool ? "True" : "False"}
          </span>
        </p>
      )}

      {question.acceptableAnswers && question.acceptableAnswers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs font-medium">Accepted answers</p>
          <div className="flex flex-wrap gap-1.5">
            {question.acceptableAnswers.map((a, i) => (
              <Badge key={`${i}-${a}`} variant="secondary" className="font-normal">
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {question.pairs && question.pairs.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {question.pairs.map((p, i) => (
                <tr key={`${i}-${p.left}`}>
                  <td className="w-1/2 border-r p-2.5 align-top">
                    <Markdown className="prose-bridge">{p.left}</Markdown>
                  </td>
                  <td className="p-2.5 align-top">
                    <Markdown className="prose-bridge">{p.right}</Markdown>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(question.hint || question.explanation || question.workedExample) && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
          {question.hint && <LabelledProse label="Hint" value={question.hint} />}
          {question.explanation && (
            <LabelledProse label="Explanation" value={question.explanation} />
          )}
          {question.workedExample && (
            <LabelledProse label="Worked example" value={question.workedExample} />
          )}
        </div>
      )}
    </div>
  );
}

function LabelledProse({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <Markdown className="prose-bridge text-sm">{value}</Markdown>
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
    <div className="shadow-card overflow-hidden rounded-xl border border-primary/30 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/5 px-4 py-3">
        <SparklesIcon className="size-4 text-primary" />
        <p className="text-sm font-medium">Proposed revision</p>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" disabled={pending} onClick={onDiscard}>
            <XIcon data-icon="inline-start" />
            Discard
          </Button>
          <Button size="sm" disabled={pending || locked} onClick={onAccept}>
            <CheckIcon data-icon="inline-start" />
            Accept &amp; approve
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {proposal.changeNote && (
          <p className="text-sm text-pretty">
            <span className="text-muted-foreground">What changed: </span>
            {proposal.changeNote}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {proposal.changed.map((field) => (
            <Badge key={field} variant="outline" className="border-primary/40 text-primary">
              {FIELD_LABELS[field]}
            </Badge>
          ))}
        </div>

        {/* Only changed fields are shown. A revision returns the whole question, most
            of it byte-identical, and printing all of it makes the reviewer hunt for
            the line that moved — which is the job the diff is here to do. */}
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

/** Renders one field before and after, side by side on wide screens. */
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
      <p className="text-muted-foreground text-xs font-medium">{FIELD_LABELS[field]}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
            Now
          </p>
          <FieldValueView field={field} question={before} />
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-muted-foreground mb-1.5 text-[11px] font-medium uppercase tracking-wide">
            Proposed
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
        <ol className="flex flex-col gap-1 text-sm">
          {question.options.map((o, i) => (
            <li key={`${i}-${o}`} className="flex gap-2">
              <span className="text-muted-foreground shrink-0 font-medium">
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
        <p className="text-sm font-medium">
          {String.fromCharCode(65 + i)}
          {question.options?.[i] ? ` — ${summarizeQuestion(question.options[i], 80)}` : ""}
        </p>
      );
    }
    case "correctBool":
      return (
        <p className="text-sm font-medium">
          {question.correctBool === null ? "—" : question.correctBool ? "True" : "False"}
        </p>
      );
    case "acceptableAnswers": {
      if (!question.acceptableAnswers?.length) return empty;
      return (
        <div className="flex flex-wrap gap-1.5">
          {question.acceptableAnswers.map((a, i) => (
            <Badge key={`${i}-${a}`} variant="secondary" className="font-normal">
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
      return <p className="text-sm font-medium tabular-nums">{question.points}</p>;
    case "visual": {
      if (!question.visual) return empty;
      return <QuestionVisualView visual={question.visual} />;
    }
    default:
      return empty;
  }
}
