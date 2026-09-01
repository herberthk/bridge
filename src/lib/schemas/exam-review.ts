import { z } from "zod";

import { QUESTION_TYPES } from "@/lib/constants";

/**
 * Request contracts for the exam review screen.
 *
 * Kept apart from `exam.ts` because these are *inbound* shapes — what a reviewer's
 * browser sends — and the tolerances are the opposite of the AI output contract's.
 * There, being loose is right: a bound that rejects a chunk loses five questions
 * the pipeline could have repaired. Here the sender is a form, so a rejection is a
 * message the reviewer can act on, and every message below is written to be read
 * by a person rather than a log.
 */

/** How many questions one AI revision call may cover. */
export const REVISION_BATCH_MAX = 10;

/**
 * How many questions one save may write.
 *
 * Larger than the revision batch because accepting a batch of proposals plus a
 * couple of hand edits arrives as one save, and because the write is a single
 * transaction either way — the cost of 25 is the cost of 1.
 */
export const SAVE_BATCH_MAX = 25;

export const REVISION_NOTE_MIN = 3;
export const REVISION_NOTE_MAX = 600;

/* ── Ask the AI to revise specific questions ─────────────────── */

export const reviseQuestionsSchema = z.object({
  examId: z
    .string()
    .min(1)
    .describe("Unique identifier of the exam containing the questions to revise."),
  items: z
    .array(
      z.object({
        questionId: z
          .string()
          .min(1)
          .describe("Unique identifier of the specific question requiring revision."),
        instruction: z
          .string()
          .trim()
          .min(REVISION_NOTE_MIN, "Say what should change")
          .max(REVISION_NOTE_MAX, `Keep it under ${REVISION_NOTE_MAX} characters`)
          .describe(
            "Educator's specific revision instructions or prompt feedback (e.g. 'Make distractor C more plausible', 'Fix notation in the prompt', 'Simplify language for Primary 6').",
          ),
      }),
    )
    .min(1, "Add a note to at least one question")
    .max(REVISION_BATCH_MAX, `Revise at most ${REVISION_BATCH_MAX} questions at a time`)
    // One note per question. Two notes for the same id would be sent to the model
    // as two independent rewrites of the same text, and only one of them could
    // survive the write — so the reviewer would silently lose half their request.
    .refine(
      (items) => new Set(items.map((i) => i.questionId)).size === items.length,
      "One note per question",
    )
    .describe(
      "List of question revision instructions, targeting up to 10 unique questions per batch.",
    ),
});
export type ReviseQuestionsInput = z.infer<typeof reviseQuestionsSchema>;

/* ── Write a question, from a hand edit or an accepted proposal ── */

/**
 * The editable content of one question.
 *
 * `id` and `type` are carried but not changed: the server matches on `id` and
 * checks `type` against what is stored, because a patch that changed a question's
 * type would leave already-recorded answers on in-flight attempts pointing at a
 * shape that no longer exists.
 *
 * Nullable-and-optional throughout, in that order, so that both callers work: the
 * inline editor sends every field for the type it is editing, and an accepted AI
 * proposal sends whatever the model returned. A key that is absent means "leave
 * it", which is also what `changedFields` in `@/lib/exam/review` assumes.
 */
export const questionPatchSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Unique identifier of the question being modified."),
  type: z
    .enum(QUESTION_TYPES)
    .describe(
      "Assessment format type of the question: 'multiple_choice', 'true_false', 'fill_in_the_blank', 'short_answer', 'essay', or 'matching'.",
    ),
  prompt: z
    .string()
    .trim()
    .min(1, "The question can't be empty")
    .max(5000, "That question is too long")
    .describe(
      "Question text / problem statement. Uses '$...$' and '$$...$$' for LaTeX math formatting, and '___' for blanks in fill_in_the_blank.",
    ),
  options: z
    .array(z.string().trim().max(500, "That option is too long"))
    .max(8, "At most 8 options")
    .nullable()
    .optional()
    .describe(
      "Array of answer options for multiple_choice questions (2 to 8 options). Null or omitted for non-multiple_choice questions.",
    ),
  correctOptionIndex: z
    .number()
    .int()
    .min(0)
    .max(25)
    .nullable()
    .optional()
    .describe(
      "0-based index of the correct option in the options array for multiple_choice questions.",
    ),
  correctBool: z
    .boolean()
    .nullable()
    .optional()
    .describe("Correct boolean value (true or false) for true_false questions."),
  acceptableAnswers: z
    .array(z.string().trim().max(200, "Accepted answers should be short"))
    .max(12, "At most 12 accepted answers")
    .nullable()
    .optional()
    .describe(
      "Array of valid plain-text accepted answer variations for fill_in_the_blank or short_answer questions. Must not contain '$' or LaTeX commands.",
    ),
  pairs: z
    .array(
      z.object({
        left: z.string().trim().max(200).describe("Left term or prompt item in the pair"),
        right: z.string().trim().max(200).describe("Right definition or answer corresponding to the left item"),
      }),
    )
    .max(10, "At most 10 pairs")
    .nullable()
    .optional()
    .describe(
      "Array of 1-to-1 matching pairs for matching questions (e.g. [{ left: 'Term A', right: 'Definition A' }]).",
    ),
  points: z
    .number()
    .int()
    .min(1, "Marks must be at least 1")
    .max(50, "Marks can't exceed 50")
    .describe("Mark weight/points allocated to this question (1 to 50 marks)."),
  // Bounded well above the 1,200-character store-time clamp: the clamp trims, so a
  // tighter bound here would refuse text the generator itself produces.
  hint: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .optional()
    .describe("Optional hint to assist students during the exam without revealing the answer."),
  explanation: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .optional()
    .describe("Pedagogical explanation detailing why the correct answer is right and distractors are wrong."),
  workedExample: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .optional()
    .describe("Step-by-step worked model solution showing method marks and reasoning."),
  /**
   * Unvalidated for the same reason as in the AI output contract: `sanitizeVisual`
   * pads short rows, coerces cells, caps sizes and returns null for anything it
   * cannot use. Validating the shape here could only turn a repairable visual into
   * a rejected save — and this payload's other source *is* the model.
   */
  visual: z
    .unknown()
    .nullable()
    .optional()
    .describe("Optional visual aid structure (chart or table) supporting the question."),
});
export type QuestionPatchInput = z.infer<typeof questionPatchSchema>;

/**
 * Per-type completeness, as one refinement over a patch.
 *
 * Exported separately from the object schema so the inline editor can run exactly
 * the same checks the server will, against a draft that is still being typed,
 * without the round trip. The paths are the editor's field names, so an issue maps
 * straight onto the control that caused it.
 */
export function refineQuestionPatch(
  patch: QuestionPatchInput,
  ctx: z.RefinementCtx,
): void {
  const filledOptions = (patch.options ?? []).filter((o) => o.trim().length > 0);
  const filledAnswers = (patch.acceptableAnswers ?? []).filter((a) => a.trim().length > 0);
  const filledPairs = (patch.pairs ?? []).filter(
    (p) => p.left.trim().length > 0 && p.right.trim().length > 0,
  );

  if (patch.type === "multiple_choice") {
    if (filledOptions.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Give at least 2 options" });
    }
    // Checked against the *filled* count, not the array length: a blank trailing
    // option row is normal in the editor, and pointing the answer key at it is the
    // way a question ends up with no correct answer at all.
    if (
      typeof patch.correctOptionIndex !== "number" ||
      patch.correctOptionIndex >= filledOptions.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["correctOptionIndex"],
        message: "Mark which option is correct",
      });
    }
  }

  if (patch.type === "true_false" && typeof patch.correctBool !== "boolean") {
    ctx.addIssue({ code: "custom", path: ["correctBool"], message: "Choose true or false" });
  }

  if (patch.type === "fill_in_the_blank" || patch.type === "short_answer") {
    if (filledAnswers.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["acceptableAnswers"],
        message: "Add at least one accepted answer",
      });
    }
    // These are string-matched against what a student types, so LaTeX in them is
    // not a formatting preference — `$\frac{9}{5}$` can never equal `9/5`, and the
    // student who answered correctly loses the mark.
    const formatted = filledAnswers.filter((a) => /\$|\\[a-zA-Z]/.test(a));
    if (formatted.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["acceptableAnswers"],
        message: "Accepted answers must be plain text — no $ or LaTeX commands",
      });
    }
  }

  if (patch.type === "fill_in_the_blank" && !patch.prompt.includes("___")) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Mark the blank with ___ (three underscores)",
    });
  }

  if (patch.type === "matching" && filledPairs.length < 2) {
    ctx.addIssue({ code: "custom", path: ["pairs"], message: "Give at least 2 complete pairs" });
  }
}

/** A patch plus its per-type completeness rules — what the server accepts. */
export const validatedQuestionPatchSchema = questionPatchSchema.superRefine(refineQuestionPatch);

export const saveQuestionsSchema = z.object({
  examId: z
    .string()
    .min(1)
    .describe("Unique identifier of the exam to update."),
  questions: z
    .array(validatedQuestionPatchSchema)
    .min(1, "Nothing to save")
    .max(SAVE_BATCH_MAX, `Save at most ${SAVE_BATCH_MAX} questions at a time`)
    .refine(
      (questions) => new Set(questions.map((q) => q.id)).size === questions.length,
      "Duplicate question in one save",
    )
    .describe("Array of validated question edits to commit to the exam."),
  /**
   * Whether saving also signs the question off.
   *
   * True when the reviewer accepted a proposal or saved a hand edit — in both cases
   * they have just read the question closely, which is what approval means. A save
   * that did not approve would make the reviewer click twice to record one act of
   * reviewing.
   */
  approve: z
    .boolean()
    .default(true)
    .describe(
      "Whether saving these questions also marks them as reviewed and approved for student testing.",
    ),
});
export type SaveQuestionsInput = z.infer<typeof saveQuestionsSchema>;

/* ── Sign-off, without changing content ─────────────────────── */

export const setApprovalSchema = z.object({
  examId: z
    .string()
    .min(1)
    .describe("Unique identifier of the exam containing the questions."),
  questionIds: z
    .array(z.string().min(1))
    .min(1)
    .max(200)
    .describe("Array of question IDs whose approval status is being updated."),
  approved: z
    .boolean()
    .describe("Whether the questions are marked as approved (true) or unapproved/draft (false)."),
});
export type SetApprovalInput = z.infer<typeof setApprovalSchema>;
