import { z } from "zod";

import { QUESTION_TYPES } from "@/lib/constants";

import type { QuestionVisual } from "@/types/firestore";

/**
 * Question shape safe to expose to the student client — correct answers,
 * explanations, and worked examples are stripped server-side.
 */
export interface SafeQuestion {
  id: string;
  type: (typeof QUESTION_TYPES)[number];
  prompt: string;
  options: string[] | null;
  pairs: { left: string; right: string }[] | null;
  points: number;
  hint: string | null;
  visual?: QuestionVisual | null;
}

export interface ExamSessionPolicy {
  preventBacktrack: boolean;
  allowReviewBeforeSubmit: boolean;
  allowSkipping: boolean;
  requireFullscreen: boolean;
  enableCameraRecording: boolean;
  enableScreenRecording: boolean;
}

export interface StartedExam {
  attemptId: string;
  examTitle: string;
  subject: string;
  durationMinutes: number;
  /** Absolute deadline (epoch ms) — the client renders a countdown to this. */
  deadlineMs: number;
  questions: SafeQuestion[];
  policy: ExamSessionPolicy;
}

export const answerSchema = z.object({
  questionId: z.string().min(1),
  response: z.union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()]),
});
export type AnswerPayload = z.infer<typeof answerSchema>;

export const submitAttemptSchema = z.object({
  answers: z.array(answerSchema).max(200),
  autoSubmitted: z.boolean().default(false),
  timeSpentSeconds: z.number().int().min(0).max(86_400),
});
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;

export const proctorEventSchema = z.object({
  type: z.enum([
    "tab_switch",
    "window_blur",
    "fullscreen_exit",
    "copy_attempt",
    "paste_attempt",
    "context_menu",
    "devtools_shortcut",
    "typing_pause",
    "multiple_faces",
    "no_face",
    "phone_detected",
    "suspicious_activity",
    "ai_flag",
  ]),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  details: z.record(z.string(), z.unknown()).default({}),
  aiVerdict: z.string().nullable().default(null),
});
export type ProctorEventInput = z.infer<typeof proctorEventSchema>;

export const recordingRefsSchema = z.object({
  cameraPath: z.string().nullable().default(null),
  screenPath: z.string().nullable().default(null),
});

/** Normalize a short text answer for fair comparison. */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'");
}
