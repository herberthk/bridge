import type {
  AttemptStatus,
  Difficulty,
  QuestionType,
  Role,
  SchoolLevel,
  SchoolVerificationStatus,
  SecondarySubLevel,
  Subject,
  TopupStatus,
  UserStatus,
  ExamStatus,
  InviteStatus,
  InviteRole,
} from "@/lib/constants";
import type { FieldValue } from "firebase/firestore";

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

/**
 * Write-side view of a document: every timestamp field also accepts
 * `FieldValue.serverTimestamp()` sentinels.
 */
type MaybeTimestamp<T> = T extends Timestamp
  ? T | FieldValue
  : T extends Timestamp | null
    ? T | FieldValue
    : T;

export type WriteModel<T> = {
  [K in keyof T]: MaybeTimestamp<T[K]>;
};

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
  /** Lowercased display name used for case-insensitive directory prefix search. */
  displayNameLower?: string;
  photoURL: string | null;
  role: Role;
  /** Owning school; null for super admins, standalone (parent/tutor) admins and members. */
  schoolId: string | null;
  status: UserStatus;
  /** Students only: P1–P7 / S1–S6. */
  classLevel: number | null;
  /** Students only: which level's curriculum they follow. */
  level: SchoolLevel | null;
  /** Students only: O level vs A level (null for primary). */
  secondarySubLevel: SecondarySubLevel | null;
  /** Students only: the class (in `classes`) they belong to; null = unassigned. */
  classId: string | null;
  /** Teachers only: ids of the classes assigned to them for management. */
  assignedClassIds: string[] | null;
  createdBy: string | null;
  banReason: string | null;
  suspendedUntil: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt: Timestamp | null;
  lastLoginMeta: LoginMeta | null;
}

/**
 * A school is either a primary OR a secondary school (chosen once, at
 * creation) — that choice drives the standard class set (P1–P7 vs S1–S6).
 */
export interface SchoolDoc {
  name: string;
  /** Lowercased name used for case-insensitive directory prefix search. */
  nameLower?: string;
  ownerUid: string;
  country: string;
  /** Primary or secondary — mutually exclusive by design. */
  level: SchoolLevel;
  motto: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Official registration number (e.g. MoES EMIS) — required for verification. */
  registrationNumber: string | null;
  logoUrl: string | null;
  description: string | null;
  /** Blue-tick workflow: super admin verifies once the info is provided. */
  verification: SchoolVerificationStatus;
  verifiedAt: Timestamp | null;
  verifiedBy: string | null;
  adminCount: number;
  teacherCount: number;
  studentCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `classes/{classId}` — one class (grade) within a school. */
export interface ClassDoc {
  schoolId: string;
  /** Denormalized from the school — a class never changes school level. */
  level: SchoolLevel;
  /** 1–7 for primary, 1–6 for secondary. */
  classLevel: number;
  /** O level vs A level (secondary only, derived from classLevel). */
  secondarySubLevel: SecondarySubLevel | null;
  /** Display name, e.g. "Primary 4" or "Senior 2". */
  name: string;
  /** Teacher uids assigned to manage this class. */
  teacherIds: string[];
  studentCount: number;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `invites/{inviteId}` — teacher invitations with single-use tokens. */
export interface InviteDoc {
  schoolId: string;
  /** Denormalized for the accept screen. */
  schoolName: string;
  email: string;
  role: InviteRole;
  /** Classes pre-assigned to the teacher on acceptance. */
  classIds: string[];
  status: InviteStatus;
  /** SHA-256 of the raw token — the raw token itself is never stored. */
  tokenHash: string;
  invitedBy: string;
  invitedByName: string | null;
  expiresAt: Timestamp;
  acceptedAt: Timestamp | null;
  acceptedBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** `topups/{topupId}` — pay-as-you-go wallet credit purchases. */
export interface TopupDoc {
  walletId: string;
  ownerId: string;
  ownerType: "admin" | "school";
  /** Which preset pack was purchased, when one was. */
  packId: string | null;
  tokens: number;
  amountUsdMicros: number;
  amountUgx: number;
  currency: "USD" | "UGX";
  status: TopupStatus;
  /** Payment provider id (e.g. "mock" until real gateways are wired). */
  provider: string;
  providerRef: string | null;
  /** Hosted-checkout URL the buyer was sent to. */
  checkoutUrl: string | null;
  completedAt: Timestamp | null;
  failedReason: string | null;
  createdBy: string;
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
  /** O level vs A level for secondary exams; null for primary. */
  secondarySubLevel: SecondarySubLevel | null;
  classLevel: number;
  topic: string;
  /** Paper/branch for subjects that need one (e.g. History: European/African). */
  subsidiary: string | null;
  difficulty: Difficulty;
  durationMinutes: number;
  questionCount: number;
  questionTypes: QuestionType[];
  includeHints: boolean;
  includeExplanations: boolean;
  includeWorkedExamples: boolean;
  instructions: string | null;
  /** Strict controls — see examParamsSchema defaults: no backtrack, no review, allow skip, require fullscreen. */
  preventBacktrack: boolean;
  allowReviewBeforeSubmit: boolean;
  allowSkipping: boolean;
  requireFullscreen: boolean;
  /** Optional recordings — disabled by default; permissions/snapshots still enforced. */
  enableCameraRecording: boolean;
  enableScreenRecording: boolean;
}

export interface MatchingPair {
  left: string;
  right: string;
}

export type QuestionVisualChart = {
  kind: "chart";
  chartType: "bar" | "line" | "pie" | "area";
  title?: string;
  caption?: string | null;
  data: Array<Record<string, string | number>>;
  xKey?: string;
  yKey?: string;
};

export type QuestionVisualTable = {
  kind: "table";
  title?: string;
  caption?: string | null;
  headers: string[];
  /**
   * One entry per row, each wrapping its cells in a map.
   *
   * Firestore rejects an array whose elements are themselves arrays
   * (`INVALID_ARGUMENT: Property array contains an invalid nested entity`), and
   * every question already lives inside the `questions` array — so a plain
   * `string[][]` here fails the whole exam write. Wrapping each row in a map
   * makes the nesting array → map → array, which Firestore allows (the same
   * shape that lets `options` and `pairs` persist).
   */
  rows: { cells: string[] }[];
};

export type QuestionVisual = QuestionVisualChart | QuestionVisualTable;

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
  /** Optional visual aid: responsive chart or table rendered alongside the prompt. */
  visual?: QuestionVisual | null;
}

export interface ExamUsage {
  generationInputTokens: number;
  generationOutputTokens: number;
  gradingTokens: number;
  /**
   * Tokens spent revising questions on the review screen, after generation.
   *
   * Optional: exams generated before the review screen existed have no such
   * field, and Firestore returns those docs with the key simply absent.
   */
  revisionTokens?: number;
}

/**
 * Reviewer sign-off, written by the review screen rather than by generation.
 *
 * Optional on `ExamDoc` for the same reason `revisionTokens` is — every exam that
 * predates the review screen would otherwise read back as malformed. Treat a
 * missing `review` as "nothing approved yet", which is the honest state.
 *
 * `approvedIds` is a list of question ids rather than a count so that revising one
 * question can withdraw *its* approval without disturbing the rest — a count would
 * have to guess which sign-off the edit invalidated.
 *
 * The instants here are ISO strings, not `Timestamp`s, and deliberately so:
 * `Serialized<T>` converts only top-level timestamp fields, so a `Timestamp` nested
 * inside this object would reach a Client Component as an ISO string while still
 * being *typed* as a Timestamp. These are display and audit values that nothing
 * range-queries, so storing them as strings keeps the type honest on both sides of
 * the boundary.
 */
export interface ExamReview {
  /** Question ids the reviewer has signed off. */
  approvedIds: string[];
  /** Questions changed since generation, by AI revision or by hand. */
  revisedCount: number;
  /** ISO instant at which every question in the exam had been approved. */
  approvedAt: string | null;
  approvedBy: string | null;
  /** ISO instant a reviewer assigned the exam with questions still unapproved. */
  overriddenAt: string | null;
  updatedAt: string | null;
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
  /** Class the exam was generated for (from the class dashboard); null = unscoped. */
  classId: string | null;
  /**
   * Deadline after which attempts can no longer start (and the exam can't be
   * assigned or retaken). Null = the exam never expires.
   */
  expiresAt: Timestamp | null;
  usage: ExamUsage;
  /** Absent on exams generated before the review screen shipped. */
  review?: ExamReview | null;
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
  /** Distinguishes request approvals from direct staff grants in audit history. */
  retakeSource?: "request" | "direct" | null;
  /** Originating request for request-approved retakes. */
  retakeRequestId?: string | null;
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
  /** Denormalized from the attempt for rule-scoped admin reads. */
  schoolId: string | null;
  type: ProctoringEventType;
  severity: ProctoringSeverity;
  details: Record<string, unknown>;
  /** AI snapshot verdict, when the event came from image analysis. */
  aiVerdict: string | null;
  occurredAt: Timestamp;
}

/* ─────────────────────────── Notifications ─────────────────────────────── */

/**
 * In-app notification. Written server-side at the moment an event happens
 * (exam assigned, retake decided, results ready, exam submitted, retake
 * requested); read + marked read by the recipient through the client SDK.
 */
export type NotificationType =
  | "exam_assigned"
  | "retake_approved"
  | "retake_rejected"
  | "results_ready"
  | "exam_submitted"
  | "retake_requested";

export interface NotificationDoc {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app deep link the notification opens. */
  link: string;
  actorId: string | null;
  read: boolean;
  readAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
