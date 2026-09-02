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

/** Secondary sub-levels per the Ugandan curriculum: O level (S1–S4) and A level (S5–S6). */
export const SECONDARY_SUB_LEVELS = ["o_level", "a_level"] as const;
export type SecondarySubLevel = (typeof SECONDARY_SUB_LEVELS)[number];

export const PRIMARY_SUBJECTS = [
  "mathematics",
  "english",
  "science",
  "social_studies",
] as const;
export type PrimarySubject = (typeof PRIMARY_SUBJECTS)[number];

/** Uganda Ordinary level (S1–S4). */
export const O_LEVEL_SUBJECTS = [
  "english",
  "mathematics",
  "biology",
  "chemistry",
  "physics",
  "geography",
  "history",
  "commerce",
  "computer_studies",
  "agriculture",
  "cre",
  "ire",
  "literature_in_english",
] as const;

/** Uganda Advanced level (S5–S6). */
export const A_LEVEL_SUBJECTS = [
  "physics",
  "chemistry",
  "biology",
  "mathematics",
  "literature_in_english",
  "geography",
  "economics_entrepreneurship",
  "history",
  "agriculture",
  "cre",
  "ire",
] as const;

export type SecondarySubject =
  | (typeof O_LEVEL_SUBJECTS)[number]
  | (typeof A_LEVEL_SUBJECTS)[number];

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
    secondary: [...new Set<Subject>([...O_LEVEL_SUBJECTS, ...A_LEVEL_SUBJECTS])],
  },
};

/** Secondary subjects per sub-level. */
export const SECONDARY_SUBJECTS_BY_SUB_LEVEL: Record<
  SecondarySubLevel,
  readonly SecondarySubject[]
> = {
  o_level: O_LEVEL_SUBJECTS,
  a_level: A_LEVEL_SUBJECTS,
};

/**
 * Subsidiary (paper/branch) choices for subjects that need one. History
 * requires European vs African; CRE and IRE are selected directly as
 * subjects; Literature in English has no subsidiaries.
 */
export const SUBJECT_SUBSIDIARIES: Partial<
  Record<Subject, { label: string; options: readonly string[] }>
> = {
  history: {
    label: "History branch",
    options: ["european_history", "african_history"],
  },
};

export const SUBSIDIARY_LABELS: Record<string, string> = {
  european_history: "European History",
  african_history: "African History",
};

export const SUB_LEVEL_LABELS: Record<SecondarySubLevel, string> = {
  o_level: "O Level (S1–S4)",
  a_level: "A Level (S5–S6)",
};

export const SUBJECT_LABELS: Record<Subject, string> = {
  mathematics: "Mathematics",
  english: "English Language",
  science: "Science",
  social_studies: "Social Studies",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  geography: "Geography",
  history: "History",
  computer_studies: "Computer Studies",
  commerce: "Commerce",
  agriculture: "Agriculture",
  cre: "Christian Religious Education (CRE)",
  ire: "Islamic Religious Education (IRE)",
  literature_in_english: "Literature in English",
  economics_entrepreneurship: "Economics & Entrepreneurship",
};

/** Uganda: Primary 1–7, Secondary 1–6. */
export const PRIMARY_CLASSES = [1, 2, 3, 4, 5, 6, 7] as const;
/** S1–S4 (Ordinary level). */
export const O_LEVEL_CLASSES = [1, 2, 3, 4] as const;
/** S5–S6 (Advanced level). */
export const A_LEVEL_CLASSES = [5, 6] as const;
export const SECONDARY_CLASSES = [...O_LEVEL_CLASSES, ...A_LEVEL_CLASSES] as const;

/** Derive the secondary sub-level from a Senior class number. */
export function subLevelForClass(classLevel: number): SecondarySubLevel {
  return classLevel >= 5 ? "a_level" : "o_level";
}

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

export const ROLES = [
  "super_admin",
  "admin",
  "teacher",
  "student",
  "member",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "School Admin",
  teacher: "Teacher",
  student: "Student",
  member: "Member",
};

/** Roles that manage a school (create classes, students, exams). */
export const STAFF_ROLES = ["admin", "teacher"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: Role): role is StaffRole {
  return role === "admin" || role === "teacher";
}

/**
 * "member" is a signed-up user who has not created (or joined) a school yet.
 * They complete onboarding to become the school's admin.
 */
export const USER_STATUSES = ["active", "suspended", "banned"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/* ── School verification ("blue tick") ─────────────────────────────── */

export const SCHOOL_VERIFICATION_STATUSES = [
  "unverified",
  "pending",
  "verified",
] as const;
export type SchoolVerificationStatus =
  (typeof SCHOOL_VERIFICATION_STATUSES)[number];

export const SCHOOL_VERIFICATION_LABELS: Record<SchoolVerificationStatus, string> = {
  unverified: "Not verified",
  pending: "Verification pending",
  verified: "Verified school",
};

/* ── Classes ───────────────────────────────────────────────────────── */

/**
 * Standard class set per school level: Primary 1–7, or Secondary 1–6
 * (S1–S4 Ordinary level, S5–S6 Advanced level).
 */
export function standardClassLevelsForLevel(
  level: SchoolLevel,
): readonly number[] {
  return level === "primary" ? PRIMARY_CLASSES : SECONDARY_CLASSES;
}

/** Display label for a class year, e.g. "Primary 4" or "Senior 2". */
export function classLabel(level: SchoolLevel, classLevel: number): string {
  return level === "primary"
    ? `Primary ${classLevel}`
    : `Senior ${classLevel}`;
}

/* ── Teacher invites ───────────────────────────────────────────────── */

export const INVITE_STATUSES = [
  "pending",
  "accepted",
  "revoked",
] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export type InviteRole = "teacher";

/** How long an invite link stays valid before the admin must re-invite. */
export const INVITE_TTL_DAYS = 7;

/* ── Wallet top-ups (pay-as-you-go credits) ────────────────────────── */

export const TOPUP_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TopupStatus = (typeof TOPUP_STATUSES)[number];

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
/**
 * Lowered from 100 because 100 was never generatable.
 *
 * The ceiling has to be a number the pipeline can actually deliver *with every
 * extra enabled* — hints, explanations and worked examples roughly quadruple the
 * output tokens per question, and that is the shape admins pick. 60 with all
 * extras is ~31,000 output tokens: twelve five-question chunks over six lanes,
 * which fits the generation budget with a wave of retries still in reserve. 100
 * of the same shape does not fit at all, so allowing it here only moved the
 * refusal from the form to a 504 several minutes later.
 */
export const EXAM_QUESTIONS_MAX = 60;

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
