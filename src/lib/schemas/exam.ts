import { z } from "zod";

import {
  DIFFICULTIES,
  QUESTION_TYPES,
  SCHOOL_LEVELS,
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
  })
  .superRefine((p, ctx) => {
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
    // Subjects with subsidiaries require a choice.
    const subsidiary = SUBJECT_SUBSIDIARIES[p.subject as keyof typeof SUBJECT_SUBSIDIARIES];
    if (subsidiary && !subsidiary.options.includes(p.subsidiary ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["subsidiary"],
        message: `Choose a branch for ${subsidiary.label}`,
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

const questionOutput = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().min(1),
  options: z.array(z.string()).nullable().default(null),
  correctOptionIndex: z.number().int().nullable().default(null),
  correctBool: z.boolean().nullable().default(null),
  acceptableAnswers: z.array(z.string()).nullable().default(null),
  pairs: z
    .array(z.object({ left: z.string(), right: z.string() }))
    .nullable()
    .default(null),
  points: z.number().int().min(1).max(50).default(1),
  hint: z.string().nullable().default(null),
  explanation: z.string().nullable().default(null),
  workedExample: z.string().nullable().default(null),
});

export const examOutputSchema = z.object({
  title: z.string().min(3).max(160),
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
