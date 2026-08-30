import { create } from "zustand";

import type { SafeQuestion } from "@/lib/schemas/attempt";

export interface ExamSessionState {
  attemptId: string | null;
  examTitle: string;
  questions: SafeQuestion[];
  deadlineMs: number;
  /** questionId → answer value (string | string[] | number | boolean). */
  answers: Record<string, string | string[] | number | boolean>;
  current: number;
  flagged: Set<string>;
  warnings: number;
  phase: "onboarding" | "exam" | "terminated";
  hydrate(payload: {
    attemptId: string;
    examTitle: string;
    questions: SafeQuestion[];
    deadlineMs: number;
    /** Restored draft answers, if any (refresh-recovery). */
    answers?: Record<string, string | string[] | number | boolean>;
  }): void;
  setAnswer(questionId: string, value: string | string[] | number | boolean): void;
  setCurrent(index: number): void;
  toggleFlag(questionId: string): void;
  setWarnings(n: number): void;
  setPhase(phase: ExamSessionState["phase"]): void;
  answeredCount(): number;
}

/**
 * True for every answer shape the store can hold, false for "not attempted".
 *
 * Fill-in-the-blank and matching answers are arrays of per-slot strings, and an
 * array of empty strings is exactly what an untouched question looks like — so a
 * bare `!== ""` check counted every multi-blank question as answered the moment
 * the student focused one of its inputs.
 */
export function isAnswered(
  value: string | string[] | number | boolean | null | undefined,
): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.some((entry) => String(entry ?? "").trim() !== "");
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/** Exam session state — one attempt per mount; deliberately not persisted. */
export const useExamSession = create<ExamSessionState>((set, get) => ({
  attemptId: null,
  examTitle: "",
  questions: [],
  deadlineMs: 0,
  answers: {},
  current: 0,
  flagged: new Set(),
  warnings: 0,
  phase: "onboarding",

  hydrate: (payload) =>
    set({
      ...payload,
      answers: payload.answers ?? {},
      current: 0,
      flagged: new Set(),
      warnings: 0,
      phase: "onboarding",
    }),

  setAnswer: (questionId, value) =>
    set((s) => ({ answers: { ...s.answers, [questionId]: value } })),

  setCurrent: (index) =>
    set((s) => ({
      current: Math.max(0, Math.min(index, s.questions.length - 1)),
    })),

  toggleFlag: (questionId) =>
    set((s) => {
      const next = new Set(s.flagged);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return { flagged: next };
    }),

  setWarnings: (n) => set({ warnings: n }),
  setPhase: (phase) => set({ phase }),

  answeredCount: () => {
    const { answers } = get();
    return Object.values(answers).filter(isAnswered).length;
  },
}));
