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
  questionId: z.string().min(1).describe("Unique identifier of the question being answered."),
  response: z
    .union([z.string(), z.array(z.string()), z.number(), z.boolean(), z.null()])
    .describe(
      "Student response payload: string (for short answer, essay, fill-in-the-blank), 0-based number index (for multiple choice), boolean (for true/false), string array (for matching or ordered items), or null if skipped/unanswered.",
    ),
});
export type AnswerPayload = z.infer<typeof answerSchema>;

export const submitAttemptSchema = z.object({
  answers: z
    .array(answerSchema)
    .max(200)
    .describe("List of student answers recorded during the exam session."),
  autoSubmitted: z
    .boolean()
    .default(false)
    .describe(
      "Whether this submission was triggered automatically (e.g. time expired or proctoring violation limit reached) rather than manually by the student.",
    ),
  timeSpentSeconds: z
    .number()
    .int()
    .min(0)
    .max(86_400)
    .describe("Total duration in seconds spent by the student on the exam attempt."),
});
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;

export const proctorEventSchema = z.object({
  type: z
    .enum([
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
    ])
    .describe(
      "Type of proctoring telemetry or security violation event detected during the student exam attempt.",
    ),
  severity: z
    .enum(["info", "low", "medium", "high", "critical"])
    .describe("Assessed integrity risk level of the proctoring event: 'info', 'low', 'medium', 'high', or 'critical'."),
  details: z
    .record(z.string(), z.unknown())
    .default({})
    .describe(
      "Telemetry metadata and contextual information regarding the event (e.g., blur duration, window dimensions, shortcut keys pressed).",
    ),
  aiVerdict: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Summary assessment or cheating risk classification emitted by AI proctoring analysis.",
    ),
});
export type ProctorEventInput = z.infer<typeof proctorEventSchema>;

export const recordingRefsSchema = z.object({
  cameraPath: z
    .string()
    .nullable()
    .default(null)
    .describe("Storage path to the student's webcam proctoring video recording file."),
  screenPath: z
    .string()
    .nullable()
    .default(null)
    .describe("Storage path to the student's screen activity recording file."),
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
