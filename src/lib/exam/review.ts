import type { ExamReview, Question } from "@/types/firestore";

/**
 * Review-state arithmetic, shared by the review screen, the assign gate and the
 * exam library badge.
 *
 * Pure and DOM-free for the same reason as `latex.ts` and `answers.ts`: the server
 * decides whether an assignment is allowed, the client decides what to render, and
 * both have to reach the same verdict from the same document. A second
 * implementation on either side is a way for the UI to offer a button the service
 * then refuses.
 */

/** Fields a reviewer or an AI revision may change. `id` and `type` are fixed. */
export const EDITABLE_FIELDS = [
  "prompt",
  "options",
  "correctOptionIndex",
  "correctBool",
  "acceptableAnswers",
  "pairs",
  "points",
  "hint",
  "explanation",
  "workedExample",
  "visual",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Short labels for the diff view — "Answer key", not "correctOptionIndex". */
export const FIELD_LABELS: Record<EditableField, string> = {
  prompt: "Question",
  options: "Options",
  correctOptionIndex: "Answer key",
  correctBool: "Answer key",
  acceptableAnswers: "Accepted answers",
  pairs: "Pairs",
  points: "Marks",
  hint: "Hint",
  explanation: "Explanation",
  workedExample: "Worked example",
  visual: "Chart / table",
};

/** The empty review a document without one is read as. */
export function emptyReview(): ExamReview {
  return {
    approvedIds: [],
    revisedCount: 0,
    approvedAt: null,
    approvedBy: null,
    overriddenAt: null,
    updatedAt: null,
  };
}

/**
 * Normalizes whatever is on the document into a usable review.
 *
 * Written defensively because three generations of exam documents flow through
 * here: ones with no `review` at all, ones written by this screen, and — if a
 * future migration is ever half-applied — ones with a partial object. Every branch
 * has to yield an `approvedIds` that is safe to call `.includes` on.
 */
export function readReview(review: ExamReview | null | undefined): ExamReview {
  if (!review || typeof review !== "object") return emptyReview();
  const ids = Array.isArray(review.approvedIds) ? review.approvedIds.filter(Boolean) : [];
  return {
    approvedIds: ids,
    revisedCount: Number.isFinite(review.revisedCount) ? review.revisedCount : 0,
    approvedAt: review.approvedAt ?? null,
    approvedBy: review.approvedBy ?? null,
    overriddenAt: review.overriddenAt ?? null,
    updatedAt: review.updatedAt ?? null,
  };
}

export interface ReviewProgress {
  approved: number;
  total: number;
  /** Ids of questions still awaiting sign-off, in paper order. */
  pendingIds: string[];
  /** 0–100, rounded — for the progress bar and the "48 of 60" line. */
  percent: number;
  complete: boolean;
}

/**
 * How far through the exam the reviewer is.
 *
 * Counts from the *questions*, not from `approvedIds.length`: an approval for a
 * question that a later edit removed would otherwise inflate the count past the
 * total and report an exam as reviewed that has an unread question in it.
 */
export function reviewProgress(
  questions: Pick<Question, "id">[],
  review: ExamReview | null | undefined,
): ReviewProgress {
  const approvedIds = new Set(readReview(review).approvedIds);
  const pendingIds = questions.filter((q) => !approvedIds.has(q.id)).map((q) => q.id);
  const total = questions.length;
  const approved = total - pendingIds.length;
  return {
    approved,
    total,
    pendingIds,
    percent: total === 0 ? 0 : Math.round((approved / total) * 100),
    // An exam with no questions is not a reviewed exam. Without this the empty
    // case reads as 0/0 complete and walks straight through the assign gate.
    complete: total > 0 && pendingIds.length === 0,
  };
}

/**
 * Whether assignment must be blocked until the review is finished.
 *
 * Only draft exams are gated. An exam that is already `scheduled` or `active` has
 * been assigned before, so gating it now would retroactively fault work that was
 * done before this screen existed — and every exam in every existing library is in
 * exactly that position. `archived` is excluded because it cannot be assigned at
 * all.
 */
export function isAssignGated(
  exam: { status: string; questions: Pick<Question, "id">[]; review?: ExamReview | null },
): boolean {
  if (exam.status !== "draft") return false;
  return !reviewProgress(exam.questions, exam.review).complete;
}

/* ── Diffing a proposed revision against the current question ─────────── */

/**
 * Value comparison for one question field.
 *
 * `JSON.stringify` rather than a deep-equality helper: every editable field is
 * already JSON — strings, numbers, booleans, string arrays, `{left,right}` pairs
 * and the visual object — and all of them come off the wire in a fixed key order
 * from the same schema. What it must not do is call two values equal because both
 * are falsy: `null`, `""` and `[]` are three different states of an option list,
 * and collapsing them hid the revision that cleared a field.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which editable fields a proposal actually changes, in a stable display order.
 *
 * The reason this exists rather than "show both versions and let the reviewer
 * look": a revision asked to fix a broken piecewise formula comes back with all
 * twelve fields populated, eleven of them byte-identical to what was already
 * there. Rendering that as a diff makes the reviewer hunt for the one line that
 * moved, which is the job the diff was supposed to do for them.
 */
export function changedFields(
  before: Partial<Record<EditableField, unknown>>,
  after: Partial<Record<EditableField, unknown>>,
): EditableField[] {
  return EDITABLE_FIELDS.filter((field) => {
    // A field the proposal omits entirely is "unchanged", not "cleared" — the
    // revision schema defaults absent keys to null, and treating that as an
    // intentional deletion would let a terse model wipe an explanation.
    if (!(field in after)) return false;
    return !sameValue(before[field], after[field]);
  });
}

/** Whether a proposal differs from the question at all. */
export function hasChanges(
  before: Partial<Record<EditableField, unknown>>,
  after: Partial<Record<EditableField, unknown>>,
): boolean {
  return changedFields(before, after).length > 0;
}
