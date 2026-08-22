import type { CollectionReference, Query } from "firebase-admin/firestore";

import { adminDb } from "./admin";
import type {
  AttemptDoc,
  AuditLogDoc,
  DailyMetricDoc,
  ExamDoc,
  PlatformFlagsDoc,
  ProctoringEventDoc,
  RetakeRequestDoc,
  SchoolDoc,
  TransactionDoc,
  UploadedDocumentDoc,
  UserDoc,
  WalletDoc,
} from "@/types/firestore";

/**
 * Typed Firestore access layer (server, Admin SDK).
 *
 * Every collection reference and document reference in the app MUST come from
 * this module — it attaches converters so `doc.data()` and `doc.set()` are
 * fully typed. Never call `.collection()` / `.doc()` directly.
 */

/** Firestore rejects `undefined` values — strip them recursively on write. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === "object" && value !== null) {
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      return value; // Timestamp-like — leave untouched
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

export function createConverter<T>(): FirebaseFirestore.FirestoreDataConverter<T> {
  return {
    toFirestore(data: T): FirebaseFirestore.DocumentData {
      return stripUndefined(data) as FirebaseFirestore.DocumentData;
    },
    fromFirestore(snapshot: FirebaseFirestore.QueryDocumentSnapshot): T {
      return snapshot.data() as T;
    },
  };
}

/* ─────────────────────────── Collection names ─────────────────────────── */

export const COLLECTIONS = {
  users: "users",
  schools: "schools",
  wallets: "wallets",
  transactions: "transactions",
  exams: "exams",
  sourceDocuments: "source_documents",
  attempts: "attempts",
  proctoringEvents: "proctoring_events",
  retakeRequests: "retake_requests",
  auditLogs: "audit_logs",
  metrics: "metrics",
  platform: "platform",
} as const;

/* ─────────────────────────── Typed accessors ─────────────────────────── */

// Users
export const usersCol = () =>
  adminDb().collection(COLLECTIONS.users).withConverter(createConverter<UserDoc>());
export const userDoc = (uid: string) =>
  adminDb().doc(`${COLLECTIONS.users}/${uid}`).withConverter(createConverter<UserDoc>());

// Schools
export const schoolsCol = () =>
  adminDb().collection(COLLECTIONS.schools).withConverter(createConverter<SchoolDoc>());
export const schoolDoc = (id: string) =>
  adminDb().doc(`${COLLECTIONS.schools}/${id}`).withConverter(createConverter<SchoolDoc>());

// Billing
export const walletsCol = () =>
  adminDb().collection(COLLECTIONS.wallets).withConverter(createConverter<WalletDoc>());
export const walletDoc = (ownerId: string) =>
  adminDb().doc(`${COLLECTIONS.wallets}/${ownerId}`).withConverter(createConverter<WalletDoc>());
export const transactionsCol = () =>
  adminDb()
    .collection(COLLECTIONS.transactions)
    .withConverter(createConverter<TransactionDoc>());
export const transactionsByWallet = (walletId: string): Query<TransactionDoc> =>
  transactionsCol().where("walletId", "==", walletId);

// Exams + source documents
export const examsCol = () =>
  adminDb().collection(COLLECTIONS.exams).withConverter(createConverter<ExamDoc>());
export const examDoc = (id: string) =>
  adminDb().doc(`${COLLECTIONS.exams}/${id}`).withConverter(createConverter<ExamDoc>());
export const sourceDocumentsCol = () =>
  adminDb()
    .collection(COLLECTIONS.sourceDocuments)
    .withConverter(createConverter<UploadedDocumentDoc>());
export const sourceDocumentDoc = (id: string) =>
  adminDb()
    .doc(`${COLLECTIONS.sourceDocuments}/${id}`)
    .withConverter(createConverter<UploadedDocumentDoc>());

// Attempts + proctoring
export const attemptsCol = () =>
  adminDb().collection(COLLECTIONS.attempts).withConverter(createConverter<AttemptDoc>());
export const attemptDoc = (id: string) =>
  adminDb().doc(`${COLLECTIONS.attempts}/${id}`).withConverter(createConverter<AttemptDoc>());
export const attemptsByStudent = (studentId: string): Query<AttemptDoc> =>
  attemptsCol().where("studentId", "==", studentId);
export const attemptsByExam = (examId: string): Query<AttemptDoc> =>
  attemptsCol().where("examId", "==", examId);
export const proctoringEventsCol = () =>
  adminDb()
    .collection(COLLECTIONS.proctoringEvents)
    .withConverter(createConverter<ProctoringEventDoc>());
export const proctoringEventsByAttempt = (attemptId: string): Query<ProctoringEventDoc> =>
  proctoringEventsCol().where("attemptId", "==", attemptId);

// Retakes
export const retakeRequestsCol = () =>
  adminDb()
    .collection(COLLECTIONS.retakeRequests)
    .withConverter(createConverter<RetakeRequestDoc>());
export const retakeRequestDoc = (id: string) =>
  adminDb()
    .doc(`${COLLECTIONS.retakeRequests}/${id}`)
    .withConverter(createConverter<RetakeRequestDoc>());

// Audit logs
export const auditLogsCol = () =>
  adminDb().collection(COLLECTIONS.auditLogs).withConverter(createConverter<AuditLogDoc>());

// Metrics — `metrics/{yyyy-mm-dd}`
export const metricsCol = () =>
  adminDb().collection(COLLECTIONS.metrics).withConverter(createConverter<DailyMetricDoc>());
export const dailyMetricDoc = (date: string) =>
  adminDb()
    .doc(`${COLLECTIONS.metrics}/${date}`)
    .withConverter(createConverter<DailyMetricDoc>());

// Platform flags singleton — `platform/flags`
export const platformFlagsDoc = () =>
  adminDb()
    .doc(`${COLLECTIONS.platform}/flags`)
    .withConverter(createConverter<PlatformFlagsDoc>());

/* ─────────────────────────── Helpers ─────────────────────────── */

/** Today's metric doc id (UTC date, yyyy-mm-dd). */
export function todayMetricId(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Collection reference type helpers for services. */
export type TypedCollection<T> = CollectionReference<T>;
