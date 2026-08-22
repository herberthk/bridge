/**
 * Bridge domain constants.
 *
 * Curriculum modelled on the Ugandan school system (primary + secondary),
 * designed to extend to other countries later via `COUNTRY_CURRICULA`.
 */

export const COUNTRIES = ["UG"] as const;
export type Country = (typeof COUNTRIES)[number];

export const SCHOOL_LEVELS = ["primary", "secondary"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

export const PRIMARY_SUBJECTS = [
  "mathematics",
  "english",
  "science",
  "social_studies",
] as const;
export type PrimarySubject = (typeof PRIMARY_SUBJECTS)[number];

export const SECONDARY_SUBJECTS = [
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "english",
  "geography",
  "history",
  "computer_studies",
] as const;
export type SecondarySubject = (typeof SECONDARY_SUBJECTS)[number];

export type Subject =
  | PrimarySubject
  | SecondarySubject;

/** Subjects available per level + country (UG for now). */
export const COUNTRY_CURRICULA: Record<
  Country,
  Record<SchoolLevel, readonly Subject[]>
> = {
  UG: {
    primary: PRIMARY_SUBJECTS,
    secondary: SECONDARY_SUBJECTS,
  },
};

export const SUBJECT_LABELS: Record<Subject, string> = {
  mathematics: "Mathematics",
  english: "English",
  science: "Science",
  social_studies: "Social Studies",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  geography: "Geography",
  history: "History",
  computer_studies: "Computer Studies",
};

/** Uganda: Primary 1–7, Secondary 1–6. */
export const PRIMARY_CLASSES = [1, 2, 3, 4, 5, 6, 7] as const;
export const SECONDARY_CLASSES = [1, 2, 3, 4, 5, 6] as const;

export const DIFFICULTIES = ["easy", "medium", "hard", "very_hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  very_hard: "Very Hard",
};

export const QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "fill_in_the_blank",
  "short_answer",
  "essay",
  "matching",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple Choice",
  true_false: "True / False",
  fill_in_the_blank: "Fill in the Blank",
  short_answer: "Short Answer",
  essay: "Essay",
  matching: "Matching",
};

export const ROLES = ["super_admin", "admin", "student"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  student: "Student",
};

export const USER_STATUSES = ["active", "suspended", "banned"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EXAM_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "archived",
] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  "pending", // assigned, not yet started
  "in_progress", // student is writing
  "submitted", // handed in, grading
  "graded", // results ready
  "flagged", // proctoring flagged, admin review required
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** Exam duration bounds (minutes). */
export const EXAM_DURATION_MIN = 5;
export const EXAM_DURATION_MAX = 240;

/** Question count bounds per exam. */
export const EXAM_QUESTIONS_MIN = 1;
export const EXAM_QUESTIONS_MAX = 100;

/** Billing constants — pay-as-you-go token metering. */
export const BILLING = {
  /** UGX per 1 USD. */
  ugxPerUsd: 3800,
  /** USD per 1000 text tokens (generation + grading). */
  usdPer1kTextTokens: 0.027,
  /** USD per minute of Gemini Live voice session. */
  usdPerVoiceMinute: 0.08,
} as const;

/** Proctoring policy. */
export const PROCTORING = {
  /** Camera snapshot cadence for AI analysis (ms). */
  snapshotIntervalMs: 30_000,
  /** Violations before the first warning. */
  warnAfterViolations: 1,
  /** Total warnings before forced submit + ban. */
  maxWarnings: 2,
} as const;
