import { z } from "zod";

import {
  DIFFICULTIES,
  QUESTION_TYPES,
  SCHOOL_LEVELS,
  EXAM_DURATION_MAX,
  EXAM_DURATION_MIN,
  EXAM_QUESTIONS_MAX,
  EXAM_QUESTIONS_MIN,
  PRIMARY_CLASSES,
  SECONDARY_CLASSES,
} from "@/lib/constants";

/** Exam parameters — shared by generation form, voice builder, and storage. */
export const examParamsSchema = z
  .object({
    subject: z.string().min(1),
    level: z.enum(SCHOOL_LEVELS),
    classLevel: z.number().int(),
    topic: z.string().trim().min(2, "Describe the topic or theme").max(200),
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
  })
  .refine(
    (p) =>
      p.level === "primary"
        ? (PRIMARY_CLASSES as readonly number[]).includes(p.classLevel)
        : (SECONDARY_CLASSES as readonly number[]).includes(p.classLevel),
    { message: "Class doesn't match the selected level", path: ["classLevel"] },
  );
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
