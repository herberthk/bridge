import { z } from "zod";

import {
  COUNTRY_CURRICULA,
  DIFFICULTIES,
  QUESTION_TYPES,
  SCHOOL_LEVELS,
  SECONDARY_SUBJECTS_BY_SUB_LEVEL,
  SECONDARY_SUB_LEVELS,
  SUBJECT_SUBSIDIARIES,
  EXAM_DURATION_MAX,
  EXAM_DURATION_MIN,
  EXAM_QUESTIONS_MAX,
  EXAM_QUESTIONS_MIN,
  PRIMARY_CLASSES,
  O_LEVEL_CLASSES,
  A_LEVEL_CLASSES,
} from "@/lib/constants";

/** Exam parameters — shared by generation form, voice builder, and storage. */
export const examParamsSchema = z
  .object({
    subject: z
      .string()
      .min(1)
      .describe(
        "Academic subject according to the Ugandan National Curriculum (e.g. 'mathematics', 'english', 'biology', 'chemistry', 'physics', 'geography', 'history', 'computer_studies', 'agriculture', 'commerce', 'cre', 'ire', 'economics_entrepreneurship').",
      ),
    level: z
      .enum(SCHOOL_LEVELS)
      .describe(
        "School education tier: 'primary' (Primary 1 to Primary 7, PLE curriculum for ages ~6–13) or 'secondary' (Ordinary / Advanced Level for ages ~13–19).",
      ),
    /** Required for secondary; must be null for primary. */
    secondarySubLevel: z
      .enum(SECONDARY_SUB_LEVELS)
      .nullable()
      .default(null)
      .describe(
        "Secondary school curriculum sub-level: 'o_level' (Ordinary Level / UCE: Senior 1 to Senior 4, ages ~13–16) or 'a_level' (Advanced Level / UACE: Senior 5 to Senior 6, ages ~17–19). Must be null for primary school.",
      ),
    classLevel: z
      .number()
      .int()
      .describe(
        "Numerical class/grade year: 1 to 7 for primary (representing P1–P7), 1 to 4 for O-level secondary (representing S1–S4), or 5 to 6 for A-level secondary (representing S5–S6).",
      ),
    topic: z
      .string()
      .trim()
      .min(2, "Describe the topic or theme")
      .max(200)
      .describe(
        "Specific topic, theme, or curriculum syllabus unit to assess (e.g. 'Photosynthesis and Plant Nutrition', 'Quadratic Equations', 'The Scramble for Africa', 'Newtonian Mechanics').",
      ),
    /** Required when the subject has subsidiaries (e.g. History). */
    subsidiary: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .default(null)
      .describe(
        "Specialized subject paper or branch when a subject splits into distinct curricula (e.g. 'african_history' vs 'european_history' for History). Set to null if the subject has no subsidiary branch.",
      ),
    difficulty: z
      .enum(DIFFICULTIES)
      .describe(
        "Target cognitive rigor and question difficulty: 'easy' (foundational recall and basic definitions), 'medium' (standard curriculum application and understanding), 'hard' (complex analysis, multi-step calculation, and synthesis), or 'very_hard' (advanced evaluation and challenging problem-solving).",
      ),
    durationMinutes: z
      .number()
      .int()
      .min(EXAM_DURATION_MIN, `Minimum ${EXAM_DURATION_MIN} minutes`)
      .max(EXAM_DURATION_MAX, `Maximum ${EXAM_DURATION_MAX} minutes`)
      .describe(
        "Allocated time limit for the examination session in minutes (range: 5 to 240 minutes).",
      ),
    questionCount: z
      .number()
      .int()
      .min(EXAM_QUESTIONS_MIN)
      .max(EXAM_QUESTIONS_MAX)
      .describe(
        "Total number of questions to generate for the exam paper (range: 1 to 60).",
      ),
    questionTypes: z
      .array(z.enum(QUESTION_TYPES))
      .min(1, "Pick at least one question type")
      .describe(
        "Array of allowed question formats to generate: 'multiple_choice', 'true_false', 'fill_in_the_blank', 'short_answer', 'essay', or 'matching'.",
      ),
    includeHints: z
      .boolean()
      .describe(
        "Whether to generate scaffolding hints to guide struggling students without revealing the answer.",
      ),
    includeExplanations: z
      .boolean()
      .describe(
        "Whether to generate detailed pedagogical explanations explaining why the correct answer is right and why distractors are wrong.",
      ),
    includeWorkedExamples: z
      .boolean()
      .describe(
        "Whether to generate full step-by-step model solutions showing methodology and marking breakdown.",
      ),
    instructions: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .describe(
        "Optional examination instructions, rubric notes, or special directives shown to students at the beginning of the exam paper.",
      ),
    // Strict exam controls — admin configurable, secure defaults as per spec
    preventBacktrack: z
      .boolean()
      .default(true)
      .describe(
        "Security policy: whether students are prevented from navigating backwards to earlier questions once submitted or passed.",
      ),
    allowReviewBeforeSubmit: z
      .boolean()
      .default(false)
      .describe(
        "Exam policy: whether students can review an overview of all their answers before final submission.",
      ),
    allowSkipping: z
      .boolean()
      .default(true)
      .describe(
        "Exam policy: whether students may skip questions to answer later within navigation constraints.",
      ),
    requireFullscreen: z
      .boolean()
      .default(true)
      .describe(
        "Proctoring policy: whether the exam browser runner enforces locked fullscreen mode to deter cheating.",
      ),
    // Recording is optional and disabled by default; onboarding still requires permissions
    enableCameraRecording: z
      .boolean()
      .default(false)
      .describe(
        "Proctoring policy: whether continuous webcam video recording is active during the exam session.",
      ),
    enableScreenRecording: z
      .boolean()
      .default(false)
      .describe(
        "Proctoring policy: whether continuous screen recording is active during the exam session.",
      ),
  })
  .superRefine((p, ctx) => {
    // Subjects with subsidiaries require a choice. Checked before the level
    // branches so it applies at primary too — the secondary branch used to
    // `return` past it.
    const subsidiary = SUBJECT_SUBSIDIARIES[p.subject as keyof typeof SUBJECT_SUBSIDIARIES];
    if (subsidiary && !subsidiary.options.includes(p.subsidiary ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["subsidiary"],
        message: `Choose a branch for ${subsidiary.label}`,
      });
    }

    if (p.level === "primary") {
      if (!(PRIMARY_CLASSES as readonly number[]).includes(p.classLevel)) {
        ctx.addIssue({
          code: "custom",
          path: ["classLevel"],
          message: "Primary classes are P1–P7",
        });
      }
      if (p.secondarySubLevel !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["secondarySubLevel"],
          message: "Sub-level only applies to secondary",
        });
      }
      if (!(COUNTRY_CURRICULA.UG.primary as readonly string[]).includes(p.subject)) {
        ctx.addIssue({
          code: "custom",
          path: ["subject"],
          message: "That subject isn't offered at primary level",
        });
      }
      return;
    }
    // Secondary: sub-level drives valid classes (O: S1–S4, A: S5–S6).
    if (!p.secondarySubLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["secondarySubLevel"],
        message: "Choose O level or A level",
      });
      return;
    }
    const valid =
      p.secondarySubLevel === "o_level" ? O_LEVEL_CLASSES : A_LEVEL_CLASSES;
    if (!(valid as readonly number[]).includes(p.classLevel)) {
      ctx.addIssue({
        code: "custom",
        path: ["classLevel"],
        message:
          p.secondarySubLevel === "o_level"
            ? "O level classes are S1–S4"
            : "A level classes are S5–S6",
      });
    }
    // The subject must exist on the chosen sub-level's curriculum. Without
    // this, `subject: z.string()` accepts anything and the AI is handed an
    // impossible brief (e.g. English at A level, which UNEB doesn't offer).
    if (
      !(SECONDARY_SUBJECTS_BY_SUB_LEVEL[p.secondarySubLevel] as readonly string[]).includes(
        p.subject,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["subject"],
        message: `That subject isn't offered at ${p.secondarySubLevel === "o_level" ? "O level" : "A level"}`,
      });
    }
  });
export type ExamParamsInput = z.infer<typeof examParamsSchema>;

export const generateExamSchema = z.object({
  params: examParamsSchema.describe("Exam specification parameters driving the generation pipeline."),
  /** Source document ids to ground generation on (optional). */
  documentIds: z
    .array(z.string())
    .max(10)
    .default([])
    .describe(
      "Optional IDs of uploaded reference notes, textbooks, or syllabus documents to ground question generation.",
    ),
});
export type GenerateExamInput = z.infer<typeof generateExamSchema>;

/* ── AI output contract ─────────────────────────────────────── */

const chartVisualSchema = z.object({
  kind: z.literal("chart").describe("Visual aid discriminator type: 'chart'."),
  chartType: z
    .enum(["bar", "line", "pie", "area"])
    .describe(
      "Type of chart: 'bar' (discrete categories/comparisons), 'line' (continuous trends over time), 'pie' (proportions <=6 slices summing to 100), or 'area' (cumulative trends).",
    ),
  title: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Short, informative title displayed above the chart graphic."),
  caption: z
    .string()
    .max(300)
    .nullable()
    .default(null)
    .describe(
      "Explanatory caption or data source citation (e.g. 'Source: 2023 Agricultural Survey').",
    ),
  /** Array of uniform objects, e.g. [{label:"Q1", value:40}, ...] */
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(2)
    .max(12)
    .describe(
      "Array of 2 to 12 uniform data point records (e.g. [{'label': '2019', 'value': 40}, {'label': '2020', 'value': 55}]). Do NOT use LaTeX or '$' in chart labels or values.",
    ),
  /** Key in data for X/label axis; defaults to first string key or "label" */
  xKey: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Object property key name used for category labels / X-axis (e.g. 'label' or 'year')."),
  /** Key in data for Y/value axis; defaults to first numeric key or "value" */
  yKey: z
    .string()
    .min(1)
    .max(30)
    .optional()
    .describe("Object property key name used for numeric measurements / Y-axis (e.g. 'value' or 'rainfall')."),
});

const tableVisualSchema = z.object({
  kind: z.literal("table").describe("Visual aid discriminator type: 'table'."),
  title: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Title displayed above the data table."),
  caption: z
    .string()
    .max(300)
    .nullable()
    .default(null)
    .describe("Footnote or explanatory context describing table data."),
  headers: z
    .array(z.string().min(1).max(60))
    .min(2)
    .max(8)
    .describe("Array of 2 to 8 column header labels. Wrap any math formulas with '$...$'."),
  /**
   * The *wire* shape: a row is a flat array of cells, which is how a model
   * naturally emits a table. Firestore cannot store an array whose elements are
   * arrays, so `sanitizeVisual` rewraps each row as `{ cells }` on the way to
   * storage — see `QuestionVisualTable` in `@/types/firestore`. Do not use this
   * type for anything that is read back out of the database.
   */
  rows: z
    .array(z.array(z.string().min(1).max(100)))
    .min(1)
    .max(12)
    .describe(
      "2D array of table rows (1 to 12 rows). Every row must have exactly the same number of cells as headers. Wrap math formulas with '$...$'.",
    ),
});

export const questionVisualSchema = z.union([chartVisualSchema, tableVisualSchema]);
/** AI-facing visual shape. The persisted shape is `QuestionVisual` in `@/types/firestore`. */
export type AiQuestionVisual = z.infer<typeof questionVisualSchema>;

/*
 * Why the output contract below is deliberately loose.
 *
 * `Output.object` validates the model's whole response as one unit, so a single
 * out-of-bounds field rejects every question that came back with it. While the
 * provider was sent a `responseSchema` that cost little: the bounds were part of
 * the decoding grammar, so the model mostly could not break them. Constrained
 * decoding is now off (see `structuredOutputs` in `exams.ts`), which turns each
 * bound into a live way to lose a five-question chunk — over a 61-point essay, a
 * one-row table, or a numeric option.
 *
 * So the rule here is: reject only what the pipeline cannot repair. Anything a
 * mapper or `sanitizeVisual` already fixes is accepted and fixed, not refused.
 */

const questionOutput = z.object({
  type: z
    .enum(QUESTION_TYPES)
    .describe(
      "Question format type: 'multiple_choice', 'true_false', 'fill_in_the_blank', 'short_answer', 'essay', or 'matching'.",
    ),
  prompt: z
    .string()
    .min(1)
    .describe(
      "The complete question prompt or problem statement. Wrap inline math with '$...$' and standalone equations with '$$...$$'. For fill_in_the_blank, use '___' (three underscores) where the blank sits.",
    ),
  // Coerced because a maths model writes `options: [1, 2, 4, 8]` often enough to
  // matter, and a stringified number is a perfectly good option.
  options: z
    .array(z.coerce.string())
    .nullable()
    .default(null)
    .describe(
      "Array of 4 distinct answer choices (A, B, C, D) for multiple_choice questions. Wrap math expressions with '$...$'. Null for non-multiple_choice types.",
    ),
  correctOptionIndex: z
    .number()
    .int()
    .nullable()
    .default(null)
    .catch(null)
    .describe(
      "0-based index of the correct answer in the options array (0 for A, 1 for B, 2 for C, 3 for D) for multiple_choice questions. Null for other question types.",
    ),
  correctBool: z
    .boolean()
    .nullable()
    .default(null)
    .catch(null)
    .describe(
      "The correct boolean answer (true or false) for true_false questions. Null for other question types.",
    ),
  acceptableAnswers: z
    .array(z.coerce.string())
    .nullable()
    .default(null)
    .describe(
      "List of acceptable plain-text string answers for fill_in_the_blank or short_answer questions (e.g. ['9/5', '1.8']). Never use '$' or LaTeX commands here because student input is exact-matched. Null for other question types.",
    ),
  pairs: z
    .array(
      z.object({
        left: z.string().describe("Left item/term in the matching pair"),
        right: z.string().describe("Right matching definition/concept corresponding to the left item"),
      }),
    )
    .nullable()
    .default(null)
    .describe(
      "Array of 4 matching key-value pairs for matching questions (e.g. [{ left: 'Photosynthesis', right: 'Chloroplast' }]). Null for other question types.",
    ),
  // `.catch` rather than a wider `.max`: the ceiling still means something (it is
  // what the grader and the score bar assume), but breaching it now costs the one
  // question's weighting instead of the whole chunk.
  points: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(1)
    .catch(1)
    .describe(
      "Score weight / marks allocated to this question (typically 1 for objective questions, 5–20 for essays/structured questions).",
    ),
  hint: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Scaffolding hint to guide students toward the correct reasoning without revealing the answer. Null if hints were not requested.",
    ),
  explanation: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Pedagogical explanation explaining why the correct answer is right and why distractors are wrong. Null if explanations were not requested.",
    ),
  workedExample: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Step-by-step model solution demonstrating how to solve this and similar problems. Null if worked examples were not requested.",
    ),
  /**
   * Accepted unvalidated on purpose. `questionVisualSchema` above documents the
   * shape the prompt asks for, but `sanitizeVisual` in `exams.ts` already pads
   * short rows, coerces non-string cells, caps sizes, strips field names Firestore
   * rejects and returns null for anything unusable — so validating here can only
   * turn a visual that would have been repaired into a lost chunk.
   */
  visual: z
    .unknown()
    .nullable()
    .default(null)
    .describe(
      "Optional accompanying visual aid object (chart or table conforming to visual schema), or null if no visual is needed.",
    ),
});

export const examOutputSchema = z.object({
  // Accepted long and trimmed to the stored bound. Refusing an otherwise perfect
  // set of questions because the title ran to 170 characters is a bad trade.
  title: z
    .string()
    .trim()
    .min(3)
    .transform((s) => s.slice(0, 160))
    .describe(
      "Formal examination title indicating subject, class level, and topic (e.g. 'Senior 4 Physics: Waves and Optics Mid-Term Examination').",
    ),
  questions: z
    .array(questionOutput)
    .min(1)
    .describe("List of generated assessment questions conforming to the requested parameters."),
});

export type ExamOutput = z.infer<typeof examOutputSchema>;
export type QuestionOutput = z.infer<typeof questionOutput>;

/**
 * What a revision call returns: the same question shape, plus the id it revises.
 *
 * The id is required and echoed back rather than inferred from array position.
 * A revision request carries a subset of the paper — "questions 4, 11 and 27" —
 * and a model asked for three revisions occasionally returns two, or reorders
 * them. Positional matching would then write question 11's replacement over
 * question 4, which is the one failure mode of this feature that silently
 * corrupts an exam instead of erroring.
 *
 * `changeNote` is the model's one-line account of what it did, shown above the
 * diff. It is presentational, so it is `.catch(null)`: a malformed note must not
 * cost the revision it describes.
 */
export const questionRevisionOutputSchema = z.object({
  questions: z
    .array(
      questionOutput.extend({
        id: z
          .string()
          .min(1)
          .describe("The unique question ID being revised, echoed back to ensure exact question matching."),
        /**
         * Nullable here, where generation defaults it to 1.
         *
         * Generation has nothing to preserve, so 1 is a sane floor. A revision
         * does: a model that simply omits `points` while rewriting the wording of
         * a 5-mark essay would re-weight it to 1, and re-weighting is the kind of
         * change a reviewer reading a diff of the *prompt* has no reason to look
         * for. Null means "unchanged", and the mapper carries the stored value.
         */
        points: z
          .number()
          .int()
          .min(1)
          .max(50)
          .nullable()
          .default(null)
          .catch(null)
          .describe("Updated mark weight for the revised question, or null to preserve existing points."),
        changeNote: z
          .string()
          .nullable()
          .default(null)
          .catch(null)
          .describe(
            "One-line summary describing the revision made (e.g. 'Updated distractor D to be more plausible and fixed LaTeX notation in prompt').",
          ),
      }),
    )
    .min(1)
    .describe("Array of revised questions matching the requested revision IDs."),
});
export type QuestionRevisionOutput = z.infer<typeof questionRevisionOutputSchema>;
export type RevisedQuestionOutput = QuestionRevisionOutput["questions"][number];

/* ── Assignment / scheduling ────────────────────────────────── */

export const assignExamSchema = z.object({
  examId: z.string().min(1).describe("Unique identifier of the exam to assign to students."),
  studentIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one student")
    .describe("Array of student user IDs who should receive and sit this examination."),
  scheduledFor: z
    .string()
    .datetime()
    .nullable()
    .default(null)
    .describe(
      "Optional ISO-8601 UTC timestamp scheduling when the exam becomes accessible. Null for immediate availability.",
    ),
  /**
   * Set only when the reviewer has confirmed the "assign anyway" dialog on a draft
   * exam whose questions are not all approved.
   *
   * Defaults to false so that every existing caller — and any future one that
   * forgets this field — gets the gate rather than bypasses it. A permission this
   * shape has to fail closed.
   */
  acknowledgeUnreviewed: z
    .boolean()
    .default(false)
    .describe(
      "Explicit confirmation to assign the exam even if some questions remain unapproved drafts.",
    ),
});
export type AssignExamInput = z.infer<typeof assignExamSchema>;
