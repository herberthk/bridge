/**
 * Exam domain — split from a single ~2,000-line `exams.ts` into focused
 * modules. This barrel preserves the original public import path
 * (`@/server/services/exams`), so no caller changes.
 *
 * - `./errors` — `ExamsServiceError`
 * - `./planning` — budget arithmetic (`planGeneration`, caps, tuning)
 * - `./content` — AI-output sanitizers (`sanitizeVisual`, `repairProse`)
 * - `./ai-errors` — failure classifiers + usage normalization
 * - `./scope` — class-scope validation for generation
 * - `./generation` — the `generateExam` pipeline
 * - `./assignment` — `assignExam` + attempt lookups
 * - `./library` — reads (`listExams`, `getExamForActor`, …)
 */
export { ExamsServiceError } from "./errors";
export {
  largestViableQuestionCount,
  outputCapFor,
  planGeneration,
  thinkingOptions,
} from "./planning";
export type { GenerationPlan } from "./planning";
export {
  isAbortError,
  isRetryableAiError,
  isTransientTransportError,
  readUsage,
} from "./ai-errors";
export { clampProse, repairProse, sanitizeVisual } from "./content";
export { resolveExamClassId } from "./scope";
export { generateExam } from "./generation";
export { assignExam, getAssignedStudentIdsForExam } from "./assignment";
export {
  countExams,
  getAttemptForActor,
  getExamForActor,
  listExams,
  listRecentExamsForClasses,
} from "./library";
export type { ExamListResult } from "./library";
