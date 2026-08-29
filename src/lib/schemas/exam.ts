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
    subject: z.string().min(1),
    level: z.enum(SCHOOL_LEVELS),
    /** Required for secondary; must be null for primary. */
    secondarySubLevel: z.enum(SECONDARY_SUB_LEVELS).nullable().default(null),
    classLevel: z.number().int(),
    topic: z.string().trim().min(2, "Describe the topic or theme").max(200),
    /** Required when the subject has subsidiaries (e.g. History). */
    subsidiary: z.string().trim().min(1).nullable().default(null),
    difficulty: z.enum(DIFFICULTIES),
    durationMinutes: z
      .number()
      .int()
      .min(EXAM_DURATION_MIN, `Minimum ${EXAM_DURATION_MIN} minutes`)
      .max(EXAM_DURATION_MAX, `Maximum ${EXAM_DURATION_MAX} minutes`),
    questionCount: z
      .number()
      .int()
      .min(EXAM_QUESTIONS_MIN)
      .max(EXAM_QUESTIONS_MAX),
    questionTypes: z.array(z.enum(QUESTION_TYPES)).min(1, "Pick at least one question type"),
    includeHints: z.boolean(),
    includeExplanations: z.boolean(),
    includeWorkedExamples: z.boolean(),
    instructions: z.string().trim().max(2000).nullable(),
    // Strict exam controls — admin configurable, secure defaults as per spec
    preventBacktrack: z.boolean().default(true),
    allowReviewBeforeSubmit: z.boolean().default(false),
    allowSkipping: z.boolean().default(true),
    requireFullscreen: z.boolean().default(true),
    // Recording is optional and disabled by default; onboarding still requires permissions
    enableCameraRecording: z.boolean().default(false),
    enableScreenRecording: z.boolean().default(false),
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
  params: examParamsSchema,
  /** Source document ids to ground generation on (optional). */
  documentIds: z.array(z.string()).max(10).default([]),
});
export type GenerateExamInput = z.infer<typeof generateExamSchema>;

/* ── AI output contract ─────────────────────────────────────── */

const chartVisualSchema = z.object({
  kind: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie", "area"]),
  title: z.string().min(1).max(120).optional(),
  caption: z.string().max(300).nullable().default(null),
  /** Array of uniform objects, e.g. [{label:"Q1", value:40}, ...] */
  data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(2).max(12),
  /** Key in data for X/label axis; defaults to first string key or "label" */
  xKey: z.string().min(1).max(30).optional(),
  /** Key in data for Y/value axis; defaults to first numeric key or "value" */
  yKey: z.string().min(1).max(30).optional(),
});

const tableVisualSchema = z.object({
  kind: z.literal("table"),
  title: z.string().min(1).max(120).optional(),
  caption: z.string().max(300).nullable().default(null),
  headers: z.array(z.string().min(1).max(60)).min(2).max(8),
  /**
   * The *wire* shape: a row is a flat array of cells, which is how a model
   * naturally emits a table. Firestore cannot store an array whose elements are
   * arrays, so `sanitizeVisual` rewraps each row as `{ cells }` on the way to
   * storage — see `QuestionVisualTable` in `@/types/firestore`. Do not use this
   * type for anything that is read back out of the database.
   */
  rows: z.array(z.array(z.string().min(1).max(100))).min(1).max(12),
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
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().min(1),
  // Coerced because a maths model writes `options: [1, 2, 4, 8]` often enough to
  // matter, and a stringified number is a perfectly good option.
  options: z.array(z.coerce.string()).nullable().default(null),
  correctOptionIndex: z.number().int().nullable().default(null).catch(null),
  correctBool: z.boolean().nullable().default(null).catch(null),
  acceptableAnswers: z.array(z.coerce.string()).nullable().default(null),
  pairs: z
    .array(z.object({ left: z.string(), right: z.string() }))
    .nullable()
    .default(null),
  // `.catch` rather than a wider `.max`: the ceiling still means something (it is
  // what the grader and the score bar assume), but breaching it now costs the one
  // question's weighting instead of the whole chunk.
  points: z.number().int().min(1).max(50).default(1).catch(1),
  hint: z.string().nullable().default(null),
  explanation: z.string().nullable().default(null),
  workedExample: z.string().nullable().default(null),
  /**
   * Accepted unvalidated on purpose. `questionVisualSchema` above documents the
   * shape the prompt asks for, but `sanitizeVisual` in `exams.ts` already pads
   * short rows, coerces non-string cells, caps sizes, strips field names Firestore
   * rejects and returns null for anything unusable — so validating here can only
   * turn a visual that would have been repaired into a lost chunk.
   */
  visual: z.unknown().nullable().default(null),
});

export const examOutputSchema = z.object({
  // Accepted long and trimmed to the stored bound. Refusing an otherwise perfect
  // set of questions because the title ran to 170 characters is a bad trade.
  title: z
    .string()
    .trim()
    .min(3)
    .transform((s) => s.slice(0, 160)),
  questions: z.array(questionOutput).min(1),
});

export type ExamOutput = z.infer<typeof examOutputSchema>;
export type QuestionOutput = z.infer<typeof questionOutput>;

/* ── Assignment / scheduling ────────────────────────────────── */

export const assignExamSchema = z.object({
  examId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1, "Select at least one student"),
  scheduledFor: z.string().datetime().nullable().default(null),
});
export type AssignExamInput = z.infer<typeof assignExamSchema>;
