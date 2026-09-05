import { FieldValue } from "firebase-admin/firestore";

import { generateText, Output } from "ai";

import { modelIds } from "@/server/ai/provider";
import {
  questionRevisionInstructions,
  questionRevisionPrompt,
} from "@/server/ai/prompts";
import type { RevisionRequestItem } from "@/server/ai/prompts";
import { adminDb } from "@/server/firebase/admin";
import { examDoc } from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import {
  assertCanAfford,
  consumeTokens,
} from "@/server/services/billing";
import {
  ExamsServiceError,
  getExamForActor,
  isAbortError,
  outputCapFor,
  readUsage,
  repairProse,
  sanitizeVisual,
  thinkingOptions,
} from "@/server/services/exams";
import type { SessionUser } from "@/server/auth/session";
import { questionRevisionOutputSchema } from "@/lib/schemas/exam";
import type { QuestionRevisionOutput, RevisedQuestionOutput } from "@/lib/schemas/exam";
import type {
  QuestionPatchInput,
  ReviseQuestionsInput,
  SaveQuestionsInput,
  SetApprovalInput,
} from "@/lib/schemas/exam-review";
import { changedFields, readReview, reviewProgress } from "@/lib/exam/review";
import type { EditableField } from "@/lib/exam/review";
import { plainMath, repairMath } from "@/lib/exam/latex";
import { estimateRevisionTokens, reserveForRevision } from "@/lib/pricing";
import type { ExamDoc, ExamReview, Question, WithId } from "@/types/firestore";
import { vertex } from "@/lib/vertext";

/**
 * The write and revise half of the exam review screen.
 *
 * Separate from the exam domain (`services/exams/`) but deliberately built
 * from its exported parts (`thinkingOptions`, `repairProse`,
 * `sanitizeVisual`, `readUsage`) rather than its own copies. A revision that
 * repaired maths differently from generation would show the reviewer a diff whose
 * only content was the two functions disagreeing.
 */

/** Wall clock for the one model call. The route declares `maxDuration = 90`. */
const REVISION_TIMEOUT_MS = 70_000;

/** Matches the generation pipeline: one in-SDK retry, then fail to the caller. */
const AI_CALL_RETRIES = 1;

/**
 * Output budget per revised question, and generous on purpose.
 *
 * A revision returns the whole question — prompt, options, hint, explanation and
 * worked example — so it is closer to a generated question than to an edit. The
 * headroom exists because truncation is not a soft failure: the JSON ends
 * mid-token and the whole call is lost, having been paid for.
 */
const OUTPUT_TOKENS_PER_QUESTION = 900;
const OUTPUT_CAP_HEADROOM = 3;

/* ── Guards ──────────────────────────────────────────────────── */

function assertStaff(actor: SessionUser): void {
  if (actor.role !== "admin" && actor.role !== "teacher" && actor.role !== "super_admin") {
    throw new ExamsServiceError("Not allowed.", 403);
  }
}

/**
 * Questions may only change while the exam is a draft.
 *
 * Once an exam is assigned, attempts exist that record answers against these
 * questions by id and by option index — a student who picked option B has stored
 * `1`, not the text. Rewriting the question underneath that silently changes what
 * they answered and what they are marked against, and no amount of review-screen
 * UI makes that recoverable. `draft` also happens to mean "no attempts exist",
 * which is why this needs no query to be certain.
 */
function assertEditable(exam: Pick<ExamDoc, "status">): void {
  if (exam.status === "draft") return;
  throw new ExamsServiceError(
    exam.status === "archived"
      ? "This exam is archived — its questions can no longer be changed."
      : "This exam has already been assigned, so its questions can no longer be changed. Duplicate it to make a revised version.",
    409,
  );
}

/* ── Mapping a model's revision onto a stored question ───────── */

/**
 * The stored question as the model should see it: editable fields only.
 *
 * `id` and `type` are left out of the JSON because the header line above it states
 * both, and repeating them inside the object being rewritten is an invitation to
 * rewrite them.
 */
function currentForPrompt(q: Question): Record<string, unknown> {
  return {
    prompt: q.prompt,
    options: q.options ?? null,
    correctOptionIndex: q.correctOptionIndex ?? null,
    correctBool: q.correctBool ?? null,
    acceptableAnswers: q.acceptableAnswers ?? null,
    pairs: q.pairs ?? null,
    points: q.points,
    hint: q.hint ?? null,
    explanation: q.explanation ?? null,
    workedExample: q.workedExample ?? null,
    visual: q.visual ?? null,
  };
}

/**
 * Build a storable question from a model revision, keeping the stored identity.
 *
 * The repair pipeline is the generation one, with one difference: `acceptableAnswers`
 * are projected to plain text through `plainMath` instead of being left alone.
 * Generation leaves them raw because the prompt asks for plain text and the answer
 * key is string-matched against what a student types. A revision has the same
 * requirement but a worse failure: a model rewriting a fraction question happily
 * returns `$\frac{9}{5}$` in the answer key, which no student can type and which
 * the inbound patch schema would then refuse — so the reviewer would accept a
 * proposal and be shown a validation error instead of a saved question.
 */
function mapRevised(stored: Question, out: RevisedQuestionOutput): Question {
  const answers = out.acceptableAnswers
    ? out.acceptableAnswers.map((a) => plainMath(a)).filter((a) => a.length > 0)
    : null;
  return {
    id: stored.id,
    // Fixed, not taken from the output. The prompt forbids changing either, and a
    // model that ignored that must not be able to reshape a stored question.
    type: stored.type,
    prompt: repairMath(out.prompt),
    options: out.options ? out.options.map(repairMath) : null,
    correctOptionIndex: out.correctOptionIndex ?? null,
    correctBool: out.correctBool ?? null,
    acceptableAnswers: answers && answers.length > 0 ? answers : null,
    pairs: out.pairs
      ? out.pairs
          .map((p) => ({ left: repairMath(p.left ?? ""), right: repairMath(p.right ?? "") }))
          .filter((p) => p.left && p.right)
      : null,
    // Null means unchanged — see the schema note on `points` in `@/lib/schemas/exam`.
    points: out.points ?? stored.points,
    hint: repairProse(out.hint),
    explanation: repairProse(out.explanation),
    workedExample: repairProse(out.workedExample),
    visual: sanitizeVisual(out.visual),
  };
}

/**
 * Build a storable question from a reviewer's hand edit or an accepted proposal.
 *
 * Runs the same repairs as the generation mapper for the same reason: an admin can
 * paste `\frac{1}{2}` without delimiters as readily as a model can emit it, and the
 * renderer cannot tell the two apart. `acceptableAnswers` are *not* passed through
 * `plainMath` here — unlike the model path, whatever reaches this function has
 * already been through `refineQuestionPatch`, which rejects `$` and LaTeX commands
 * outright. Projecting anyway would rewrite what the reviewer typed (`x^2` → `x²`)
 * into something their students cannot enter.
 *
 * A field the patch omits keeps the stored value, which is what makes a partial
 * patch from a single-field editor safe to send.
 */
function mapPatch(stored: Question, patch: QuestionPatchInput): Question {
  const keep = <T>(value: T | null | undefined, fallback: T | null): T | null =>
    value === undefined ? fallback : (value ?? null);
  return {
    id: stored.id,
    type: stored.type,
    prompt: repairMath(patch.prompt),
    options: patch.options
      ? patch.options.map(repairMath).filter((o) => o.length > 0)
      : keep(patch.options, stored.options),
    correctOptionIndex: keep(patch.correctOptionIndex, stored.correctOptionIndex),
    correctBool: keep(patch.correctBool, stored.correctBool),
    acceptableAnswers: patch.acceptableAnswers
      ? patch.acceptableAnswers.filter((a) => a.length > 0)
      : keep(patch.acceptableAnswers, stored.acceptableAnswers),
    pairs: patch.pairs
      ? patch.pairs
          .map((p) => ({ left: repairMath(p.left), right: repairMath(p.right) }))
          .filter((p) => p.left && p.right)
      : keep(patch.pairs, stored.pairs),
    points: patch.points,
    hint: "hint" in patch ? repairProse(patch.hint) : stored.hint,
    explanation: "explanation" in patch ? repairProse(patch.explanation) : stored.explanation,
    workedExample:
      "workedExample" in patch ? repairProse(patch.workedExample) : stored.workedExample,
    // `sanitizeVisual` is idempotent over the stored `{ cells }` row shape, so a
    // proposal that round-tripped a table through the client survives unchanged.
    visual: "visual" in patch ? sanitizeVisual(patch.visual) : (stored.visual ?? null),
  };
}

/** The editable slice of a question, for `changedFields`. */
function editableOf(q: Question): Record<EditableField, unknown> {
  return {
    prompt: q.prompt,
    options: q.options ?? null,
    correctOptionIndex: q.correctOptionIndex ?? null,
    correctBool: q.correctBool ?? null,
    acceptableAnswers: q.acceptableAnswers ?? null,
    pairs: q.pairs ?? null,
    points: q.points,
    hint: q.hint ?? null,
    explanation: q.explanation ?? null,
    workedExample: q.workedExample ?? null,
    visual: q.visual ?? null,
  };
}

/* ── Ask the AI to revise questions ─────────────────────────── */

/** One proposed rewrite, held by the client until the reviewer accepts it. */
export interface RevisionProposal {
  questionId: string;
  /** 1-based position in the paper, so the client can label it without a lookup. */
  number: number;
  /** Echoed back so a card can show what was asked alongside what came back. */
  instruction: string;
  /** The model's one-line account of what it changed. */
  changeNote: string | null;
  /** The revised question, repaired and sanitized — saveable exactly as it is. */
  question: Question;
  /** Fields that actually differ from what is stored, in display order. */
  changed: EditableField[];
}

export interface ReviseQuestionsResult {
  proposals: RevisionProposal[];
  /**
   * Questions the model did not return, or returned identically.
   *
   * Reported rather than thrown: in a batch of eight, one unanswered question is a
   * per-card message and seven usable proposals, not a failed request.
   */
  skipped: { questionId: string; reason: string }[];
  tokensUsed: number;
  warnings: string[];
}

/**
 * Revise specific questions with the model — and write nothing.
 *
 * Nothing is persisted here except the token spend, because the reviewer decides
 * whether each proposal is an improvement. That is the whole point of the
 * propose-then-accept flow: a revision that made the question worse should cost a
 * glance at a diff, not an undo.
 */
export async function reviseQuestions(
  actor: SessionUser,
  input: ReviseQuestionsInput,
): Promise<ReviseQuestionsResult> {
  assertStaff(actor);
  const exam = await getExamForActor(actor, input.examId);
  assertEditable(exam);

  const positions = new Map(exam.questions.map((q, i) => [q.id, i]));
  const items: RevisionRequestItem[] = [];
  const stored = new Map<string, Question>();
  for (const item of input.items) {
    const at = positions.get(item.questionId);
    if (at === undefined) {
      throw new ExamsServiceError(
        "That question is no longer part of this exam. Reload the page and try again.",
        409,
      );
    }
    const question = exam.questions[at]!;
    stored.set(question.id, question);
    items.push({
      id: question.id,
      number: at + 1,
      type: question.type,
      current: currentForPrompt(question),
      instruction: item.instruction,
    });
  }

  const walletId = actor.schoolId ?? actor.uid;
  const estimate = estimateRevisionTokens(items.length);
  await assertCanAfford(walletId, reserveForRevision(estimate));

  const modelId = modelIds.text();
  const cap = outputCapFor(items.length * OUTPUT_TOKENS_PER_QUESTION, OUTPUT_CAP_HEADROOM);
  const startedAt = Date.now();

  let output: QuestionRevisionOutput;
  let tokens = 0;
  try {
    const result = await generateText({
      model: vertex(modelId),
      output: Output.object({ schema: questionRevisionOutputSchema }),
      // `system` is deprecated in favour of `instructions` in this SDK major.
      instructions: questionRevisionInstructions(
        exam.params,
        items.map((i) => i.type),
      ),
      prompt: questionRevisionPrompt(exam.params, items),
      // Lower than generation's 0.35. There is nothing to invent here: the question
      // exists and the instruction says what to do to it, so sampling variety buys
      // only drift from an original the reviewer wants left alone.
      // temperature: 0.2,
      maxOutputTokens: cap,
      maxRetries: AI_CALL_RETRIES,
      abortSignal: AbortSignal.timeout(REVISION_TIMEOUT_MS),
      // Same reason as generation: constrained decoding sends this model into a
      // repetition loop on long prose fields. See `genSingle` in `exams.ts`.
      providerOptions: {
        google: { thinkingConfig: thinkingOptions(modelId), structuredOutputs: false },
        googleVertex: { thinkingConfig: thinkingOptions(modelId), structuredOutputs: false },
      },
    });
    output = result.output as QuestionRevisionOutput;
    tokens = readUsage(result.usage).tokens;
  } catch (err) {
    console.error("[exam-review] revision call failed", err);
    if (isAbortError(err)) {
      throw new ExamsServiceError(
        "The revision took too long. Try fewer questions in one go.",
        504,
      );
    }
    throw new ExamsServiceError(
      "The AI could not revise these questions. Try rewording the instruction.",
      502,
    );
  }

  const warnings: string[] = [];
  const skipped: ReviseQuestionsResult["skipped"] = [];
  const proposals: RevisionProposal[] = [];
  const seen = new Set<string>();

  for (const revised of output.questions) {
    const before = stored.get(revised.id);
    if (!before) {
      // A hallucinated or mangled id. Dropped rather than positionally matched:
      // writing one question's rewrite over another is the single failure mode of
      // this feature that corrupts an exam instead of erroring.
      warnings.push("The AI returned a revision that did not match any question, and it was ignored.");
      continue;
    }
    if (seen.has(revised.id)) continue;
    seen.add(revised.id);

    const question = mapRevised(before, revised);
    const changed = changedFields(editableOf(before), editableOf(question));
    if (changed.length === 0) {
      skipped.push({
        questionId: revised.id,
        reason: "The AI returned this question unchanged.",
      });
      continue;
    }
    proposals.push({
      questionId: revised.id,
      number: positions.get(revised.id)! + 1,
      instruction: input.items.find((i) => i.questionId === revised.id)?.instruction ?? "",
      changeNote: revised.changeNote,
      question,
      changed,
    });
  }

  for (const item of items) {
    if (seen.has(item.id)) continue;
    skipped.push({
      questionId: item.id,
      reason: "The AI did not return a revision for this question.",
    });
  }

  console.log(
    `[exam-review] revised ${proposals.length}/${items.length} q for exam ${input.examId}, ` +
      `${tokens} tokens (cap ${cap}) in ${Date.now() - startedAt}ms`,
  );

  /**
   * Billed after the fact, and its failure is a warning rather than an error.
   *
   * The tokens are already spent whatever happens next, and the proposals cost
   * nothing to hand back — they are not yet part of the exam. Throwing here would
   * charge the wallet for work the reviewer never got to see.
   */
  if (tokens > 0) {
    try {
      await consumeTokens({
        walletId,
        tokens,
        category: "text_generation",
        description: `Revised ${items.length} question(s) in “${exam.title}”`,
        refType: "exam",
        refId: input.examId,
        actorId: actor.uid,
      });
      await examDoc(input.examId).update({
        "usage.revisionTokens": FieldValue.increment(tokens),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("[exam-review] billing failed", err, { walletId, tokens });
      warnings.push("This revision could not be billed. The platform admin has been notified.");
      await writeAudit({
        actorId: actor.uid,
        actorRole: actor.role,
        action: "exam.billing_failed",
        targetType: "exam",
        targetId: input.examId,
        meta: { walletId, tokensUsed: tokens, reason: "revision" },
      });
    }
  }

  return { proposals, skipped, tokensUsed: tokens, warnings };
}

/* ── Writing questions and review state ─────────────────────── */

export interface SaveQuestionsResult {
  /** The exam's questions after the write, for the client to reconcile against. */
  questions: Question[];
  review: ExamReview;
  /** How many of the submitted questions actually differed from what was stored. */
  changedCount: number;
}

/**
 * Apply hand edits and accepted proposals, and sign the questions off.
 *
 * One transaction over the whole `questions` array, because Firestore cannot update
 * an array element by index: any write has to read the array, replace members and
 * write it back, and doing that outside a transaction loses one of two concurrent
 * saves — which on this screen means a reviewer's edit vanishing while they watch
 * a second tab's toast say it succeeded.
 */
export async function saveQuestions(
  actor: SessionUser,
  input: SaveQuestionsInput,
): Promise<SaveQuestionsResult> {
  assertStaff(actor);
  // Authorization first, outside the transaction: a 403 must not depend on winning
  // a write lock, and `getExamForActor` is the one place that decides it.
  const preflight = await getExamForActor(actor, input.examId);
  assertEditable(preflight);

  return adminDb().runTransaction<SaveQuestionsResult>(async (tx) => {
    const ref = examDoc(input.examId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamsServiceError("Exam not found.", 404);
    const exam = snap.data()!;
    // Re-checked inside the transaction: the exam may have been assigned between
    // the preflight read and this one, and the whole point of the guard is that a
    // question never changes under an attempt.
    assertEditable(exam);

    const patches = new Map(input.questions.map((q) => [q.id, q]));
    let changedCount = 0;
    const touched: string[] = [];

    const questions = exam.questions.map((current) => {
      const patch = patches.get(current.id);
      if (!patch) return current;
      patches.delete(current.id);
      if (patch.type !== current.type) {
        // Not a mismatch worth repairing. Either the client is stale or the payload
        // was tampered with, and both mean the reviewer is not looking at the
        // question they think they are.
        throw new ExamsServiceError(
          "That question has changed since you opened it. Reload the page and try again.",
          409,
        );
      }
      const next = mapPatch(current, patch);
      touched.push(current.id);
      if (changedFields(editableOf(current), editableOf(next)).length > 0) changedCount += 1;
      return next;
    });

    if (patches.size > 0) {
      throw new ExamsServiceError(
        "Some of those questions are no longer part of this exam. Reload the page and try again.",
        409,
      );
    }

    const previous = readReview(exam.review);
    const approved = new Set(previous.approvedIds);
    for (const id of touched) {
      // A save either signs the question off or withdraws sign-off. Withdrawal is
      // the right default for the "save without approving" case: the content the
      // reviewer approved is not the content now stored.
      if (input.approve) approved.add(id);
      else approved.delete(id);
    }

    const nowIso = new Date().toISOString();
    const nextApprovedIds = questions.filter((q) => approved.has(q.id)).map((q) => q.id);
    const progress = reviewProgress(questions, { ...previous, approvedIds: nextApprovedIds });
    const review: ExamReview = {
      approvedIds: nextApprovedIds,
      revisedCount: previous.revisedCount + changedCount,
      // Stamped the moment the last question is signed off and cleared if a later
      // edit reopens one, so the field always answers "is this paper ready" rather
      // than "was it ever ready".
      approvedAt: progress.complete ? (previous.approvedAt ?? nowIso) : null,
      approvedBy: progress.complete ? (previous.approvedBy ?? actor.uid) : null,
      overriddenAt: previous.overriddenAt,
      updatedAt: nowIso,
    };

    tx.update(ref, { questions, review, updatedAt: FieldValue.serverTimestamp() });
    return { questions, review, changedCount };
  });
}

/**
 * Approve or un-approve questions without changing their content.
 *
 * Shares the transactional read-modify-write with `saveQuestions` rather than
 * writing `review` on its own, because "approve all" and a concurrent save of one
 * question both rewrite `approvedIds` — and the loser of that race would otherwise
 * drop the other's ids.
 */
export async function setApproval(
  actor: SessionUser,
  input: SetApprovalInput,
): Promise<ExamReview> {
  assertStaff(actor);
  const preflight = await getExamForActor(actor, input.examId);
  assertEditable(preflight);

  return adminDb().runTransaction<ExamReview>(async (tx) => {
    const ref = examDoc(input.examId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ExamsServiceError("Exam not found.", 404);
    const exam = snap.data()!;
    assertEditable(exam);

    const ids = new Set(exam.questions.map((q) => q.id));
    const unknown = input.questionIds.filter((id) => !ids.has(id));
    if (unknown.length > 0) {
      throw new ExamsServiceError(
        "Some of those questions are no longer part of this exam. Reload the page and try again.",
        409,
      );
    }

    const previous = readReview(exam.review);
    const approved = new Set(previous.approvedIds);
    for (const id of input.questionIds) {
      if (input.approved) approved.add(id);
      else approved.delete(id);
    }

    const nowIso = new Date().toISOString();
    // Rebuilt in paper order from the questions themselves, which also drops any
    // approval left behind by a question that no longer exists.
    const nextApprovedIds = exam.questions.filter((q) => approved.has(q.id)).map((q) => q.id);
    const progress = reviewProgress(exam.questions, {
      ...previous,
      approvedIds: nextApprovedIds,
    });
    const review: ExamReview = {
      approvedIds: nextApprovedIds,
      revisedCount: previous.revisedCount,
      approvedAt: progress.complete ? (previous.approvedAt ?? nowIso) : null,
      approvedBy: progress.complete ? (previous.approvedBy ?? actor.uid) : null,
      overriddenAt: previous.overriddenAt,
      updatedAt: nowIso,
    };

    tx.update(ref, { review, updatedAt: FieldValue.serverTimestamp() });
    return review;
  });
}

/** The exam plus its review state, for the review screen's server component. */
export async function getExamForReview(
  actor: SessionUser,
  examId: string,
): Promise<WithId<ExamDoc>> {
  assertStaff(actor);
  return getExamForActor(actor, examId);
}
