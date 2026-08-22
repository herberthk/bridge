import type {
  AttemptStatus,
  Difficulty,
  QuestionType,
  Role,
  SchoolLevel,
  Subject,
  UserStatus,
  ExamStatus,
} from "@/lib/constants";

/**
 * Firestore document types — the single source of truth for the database
 * schema. All reads/writes go through the typed access layer in
 * `src/server/firebase/collections.ts` so these are enforced at compile time.
 */

/**
 * Structural timestamp satisfied by both `firebase/firestore`.Timestamp and
 * `firebase-admin`'s Timestamp — keeps client and server types compatible.
 */
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

type Timestamp = FirestoreTimestamp;

/** A document plus its auto-generated id, as returned from reads. */
export type WithId<T> = T & { id: string };

/** Denormalized login context captured for analytics/audit. */
export interface LoginMeta {
  ip: string | null;
  userAgent: string | null;
  browser: string | null;
  device: string | null;
}

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL: string | null;
  role: Role;
  /** Owning school; null for super admins and standalone (parent/tutor) admins. */
  schoolId: string | null;
  status: UserStatus;
  /** Students only: P1–P7 / S1–S6. */
  classLevel: number | null;
  /** Students only: which level's curriculum they follow. */
  level: SchoolLevel | null;
  createdBy: string | null;
  banReason: string | null;
  suspendedUntil: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt: Timestamp | null;
  lastLoginMeta: LoginMeta | null;
}

export interface SchoolDoc {
  name: string;
  ownerUid: string;
  country: string;
  adminCount: number;
  studentCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─────────────────────────── Billing ─────────────────────────── */

export type WalletOwner = { kind: "admin"; id: string } | { kind: "school"; id: string };

export interface WalletDoc {
  ownerId: string;
  ownerType: "admin" | "school";
  /** Current spendable token balance. */
  balanceTokens: number;
  totalTopupTokens: number;
  totalConsumedTokens: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TransactionType = "topup" | "consumption" | "adjustment" | "refund";
export type TransactionCategory =
  | "text_generation"
  | "grading"
  | "voice"
  | "topup"
  | "adjustment";

export interface TransactionDoc {
  walletId: string;
  ownerId: string;
  type: TransactionType;
  category: TransactionCategory;
  /** Signed token delta (negative for consumption). */
  tokensDelta: number;
  balanceAfter: number;
  usdMicros: number;
  ugx: number;
  description: string;
  refType: string | null;
  refId: string | null;
  createdBy: string | null;
  createdAt: Timestamp;
}

/* ─────────────────────────── Exams ─────────────────────────── */

export interface ExamParams {
  subject: Subject;
  level: SchoolLevel;
  classLevel: number;
  topic: string;
  difficulty: Difficulty;
  durationMinutes: number;
  questionCount: number;
  questionTypes: QuestionType[];
  includeHints: boolean;
  includeExplanations: boolean;
  includeWorkedExamples: boolean;
  instructions: string | null;
}

export interface MatchingPair {
  left: string;
  right: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  /** Markdown; may contain $…$ / $$…$$ math. */
  prompt: string;
  /** Multiple choice options. */
  options: string[] | null;
  correctOptionIndex: number | null;
  /** True/false. */
  correctBool: boolean | null;
  /** Fill-in-the-blank / short-answer acceptable answers. */
  acceptableAnswers: string[] | null;
  /** Matching pairs (left = prompt side). */
  pairs: MatchingPair[] | null;
  points: number;
  hint: string | null;
  explanation: string | null;
  workedExample: string | null;
}

export interface ExamUsage {
  generationInputTokens: number;
  generationOutputTokens: number;
  gradingTokens: number;
}

export interface ExamDoc {
  title: string;
  params: ExamParams;
  questions: Question[];
  /** "params" = generated from the form; "documents" = grounded on uploads. */
  sourceType: "params" | "documents";
  sourceDocumentIds: string[];
  status: ExamStatus;
  createdBy: string;
  schoolId: string | null;
  usage: ExamUsage;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UploadedDocumentDoc {
  ownerId: string;
  schoolId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  parseStatus: "pending" | "parsed" | "failed";
  parsedText: string | null;
  pageCount: number | null;
  createdAt: Timestamp;
}

/* ─────────────────────────── Attempts ─────────────────────────── */

export type AnswerValue = string | string[] | number | boolean | null;

export interface GradedAnswer {
  earned: number;
  possible: number;
  /** null for partially-graded or AI-judged answers. */
  correct: boolean | null;
  feedback: string | null;
}

export interface AttemptAnswer {
  questionId: string;
  type: QuestionType;
  response: AnswerValue;
  graded: GradedAnswer | null;
}

export interface AttemptScore {
  earned: number;
  possible: number;
  percentage: number;
}

export interface AttemptFeedback {
  /** Overall markdown narrative from the AI grader. */
  overall: string;
  strengths: string[];
  improvements: string[];
  /** Per-question feedback keyed by question id. */
  perQuestion: Record<string, string>;
  generatedByModel: string | null;
}

export interface AttemptRecordings {
  cameraPath: string | null;
  screenPath: string | null;
}

export interface AttemptDoc {
  examId: string;
  studentId: string;
  schoolId: string | null;
  status: AttemptStatus;
  scheduledFor: Timestamp | null;
  startedAt: Timestamp | null;
  submittedAt: Timestamp | null;
  autoSubmitted: boolean;
  timeSpentSeconds: number | null;
  answers: AttemptAnswer[];
  score: AttemptScore | null;
  violationsCount: number;
  warningsIssued: number;
  recordings: AttemptRecordings;
  gradedAt: Timestamp | null;
  feedback: AttemptFeedback | null;
  /** Set when this attempt is an approved retake of an earlier one. */
  retakeOf: string | null;
  retakeAuthorizedBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─────────────────────────── Proctoring ─────────────────────────── */

export type ProctoringEventType =
  | "tab_switch"
  | "window_blur"
  | "fullscreen_exit"
  | "copy_attempt"
  | "paste_attempt"
  | "context_menu"
  | "devtools_shortcut"
  | "typing_pause"
  | "multiple_faces"
  | "no_face"
  | "phone_detected"
  | "suspicious_activity"
  | "ai_flag";

export type ProctoringSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface ProctoringEventDoc {
  attemptId: string;
  examId: string;
  studentId: string;
  type: ProctoringEventType;
  severity: ProctoringSeverity;
  details: Record<string, unknown>;
  /** AI snapshot verdict, when the event came from image analysis. */
  aiVerdict: string | null;
  occurredAt: Timestamp;
}

/* ─────────────────────────── Requests / logs / metrics ─────────────────── */

export interface RetakeRequestDoc {
  attemptId: string;
  examId: string;
  studentId: string;
  schoolId: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface AuditLogDoc {
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Timestamp;
}

/** `metrics/daily/{yyyy-mm-dd}` — aggregated counters for analytics. */
export interface DailyMetricDoc {
  date: string;
  attemptsStarted: number;
  attemptsSubmitted: number;
  attemptsFlagged: number;
  examsGenerated: number;
  tokensConsumed: number;
  usdRevenueMicros: number;
  voiceMinutesMilli: number;
  newStudents: number;
  newAdmins: number;
  activeLogins: number;
  bySubject: Record<string, number>;
  byLevel: Record<string, number>;
  byBrowser: Record<string, number>;
  byDevice: Record<string, number>;
  updatedAt: Timestamp;
}

/** `platform/flags` — singleton. */
export interface PlatformFlagsDoc {
  setupCompleted: boolean;
  setupCompletedAt: Timestamp | null;
}
