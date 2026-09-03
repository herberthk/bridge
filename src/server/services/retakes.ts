import {
  FieldPath,
  FieldValue,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  attemptDoc,
  attemptsCol,
  examDoc,
  retakeRequestDoc,
  retakeRequestsCol,
  userDoc,
  usersCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { notifyUsers, staffRecipientsForStudent } from "@/server/services/notifications";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptDoc,
  FirestoreTimestamp,
  WithId,
  RetakeRequestDoc,
  WriteModel,
} from "@/types/firestore";

export class RetakesServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/** Student asks their admin for a retake of a graded/flagged attempt. */
export async function requestRetake(
  actor: SessionUser,
  attemptId: string,
  reason: string,
): Promise<WithId<RetakeRequestDoc>> {
  if (actor.role !== "student") {
    throw new RetakesServiceError("Only students can request retakes.", 403);
  }
  const attemptSnap = await attemptDoc(attemptId).get();
  if (!attemptSnap.exists) throw new RetakesServiceError("Attempt not found.", 404);
  const attempt = attemptSnap.data()!;
  if (attempt.studentId !== actor.uid) {
    throw new RetakesServiceError("Not your attempt.", 403);
  }
  if (attempt.status !== "graded" && attempt.status !== "flagged") {
    throw new RetakesServiceError("Retakes can be requested after results are out.", 409);
  }

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<RetakeRequestDoc> = {
    attemptId,
    examId: attempt.examId,
    studentId: actor.uid,
    schoolId: attempt.schoolId,
    reason,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
  };
  const ref = retakeRequestsCol().doc();
  await adminDb().runTransaction(async (tx) => {
    // Lock the shared source attempt as the serialization point. Querying an
    // empty result alone would not lock a document for a concurrent request.
    const currentAttemptSnap = await tx.get(attemptDoc(attemptId));
    if (!currentAttemptSnap.exists) {
      throw new RetakesServiceError("Attempt not found.", 404);
    }
    const currentAttempt = currentAttemptSnap.data()!;
    if (currentAttempt.studentId !== actor.uid) {
      throw new RetakesServiceError("Not your attempt.", 403);
    }
    if (currentAttempt.status !== "graded" && currentAttempt.status !== "flagged") {
      throw new RetakesServiceError("Retakes can be requested after results are out.", 409);
    }
    const pendingQuery = retakeRequestsCol()
      .where("attemptId", "==", attemptId)
      .where("status", "==", "pending")
      .limit(1);
    // Query by retakeOf only, then filter student/status client-side to avoid a
    // new composite index. Both invariants are read in the transaction that
    // creates the request so concurrent submissions cannot both pass them.
    const openRetakeQuery = attemptsCol()
      .where("retakeOf", "==", attemptId);
    const [pendingSnap, openRetakeSnap] = await Promise.all([
      tx.get(pendingQuery),
      tx.get(openRetakeQuery),
    ]);
    if (!pendingSnap.empty) {
      throw new RetakesServiceError("A retake request is already pending for this exam.", 409);
    }
    for (const retakeDoc of openRetakeSnap.docs) {
      const retake = retakeDoc.data();
      if (retake.studentId !== actor.uid) continue;
      if (retake.status === "pending" || retake.status === "in_progress" || retake.status === "submitted") {
        throw new RetakesServiceError("You already have an approved retake for this exam — complete it before requesting another.", 409);
      }
    }
    tx.create(ref, doc);
  });
  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "retake.requested",
    targetType: "attempt",
    targetId: attemptId,
  });

  // Notify the school admin + the teachers of the student's class.
  void (async () => {
    try {
      const staff = await staffRecipientsForStudent(actor.uid);
      if (!staff) return;
      const examTitle = (await getExamTitle(attempt.examId)) ?? "an exam";
      const body = `${actor.displayName} requested a retake for “${examTitle}”: ${reason}`;
      const base = { type: "retake_requested" as const, body, actorId: actor.uid };
      await Promise.all([
        notifyUsers(staff.adminIds, { ...base, title: `Retake requested: ${examTitle}`, link: "/admin/requests" }),
        notifyUsers(staff.teacherIds, { ...base, title: `Retake requested: ${examTitle}`, link: "/teacher/requests" }),
      ]);
    } catch (err) {
      console.error("[retakes] request notification failed", err);
    }
  })();

  return { id: ref.id, ...(doc as RetakeRequestDoc) };
}

/** Admin approves/rejects; approval creates a fresh pending attempt. */
export async function decideRetake(
  actor: SessionUser,
  requestId: string,
  approve: boolean,
): Promise<{ newAttemptId: string | null }> {
  if (actor.role !== "admin" && actor.role !== "super_admin" && actor.role !== "teacher") {
    throw new RetakesServiceError("Not allowed.", 403);
  }
  const requestRef = retakeRequestDoc(requestId);
  const newAttemptRef = approve ? attemptsCol().doc() : null;
  const decided = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) throw new RetakesServiceError("Request not found.", 404);
    const request = snap.data()!;
    if (request.status !== "pending") {
      throw new RetakesServiceError("This request was already decided.", 409);
    }
    // Decision rights: teachers decide only for students in their assigned
    // classes; school admins for their school; standalone admins only for
    // students they created; super admins for everything.
    const studentSnap = await tx.get(userDoc(request.studentId));
    if (!studentSnap.exists) {
      throw new RetakesServiceError("Student not found.", 404);
    }
    const student = studentSnap.data()!;
    if (actor.role === "teacher") {
      const teacherSnap = await tx.get(userDoc(actor.uid));
      const assigned = teacherSnap.exists ? (teacherSnap.data()!.assignedClassIds ?? []) : [];
      if (!student.classId || !assigned.includes(student.classId)) {
        throw new RetakesServiceError("This student is not in one of your classes.", 403);
      }
    } else if (actor.role === "admin") {
      if (actor.schoolId) {
        if (request.schoolId !== actor.schoolId) {
          throw new RetakesServiceError("This student belongs to another school.", 403);
        }
      } else if (request.schoolId != null || student.createdBy !== actor.uid) {
        throw new RetakesServiceError("This student was not created by you.", 403);
      }
    }

    if (approve) {
      const originalAttemptSnap = await tx.get(attemptDoc(request.attemptId));
      if (!originalAttemptSnap.exists) {
        throw new RetakesServiceError("Attempt not found.", 404);
      }
      const openQuery = attemptsCol()
        .where("retakeOf", "==", request.attemptId);
      const openSnap = await tx.get(openQuery);
      for (const retakeDoc of openSnap.docs) {
        const retake = retakeDoc.data();
        if (retake.studentId !== request.studentId) continue;
        if (retake.status === "pending" || retake.status === "in_progress" || retake.status === "submitted") {
          throw new RetakesServiceError("An approved retake is already pending for this exam — student must complete it first.", 409);
        }
      }
      const now = FieldValue.serverTimestamp();
      const attempt: WriteModel<AttemptDoc> = {
        examId: request.examId,
        studentId: request.studentId,
        schoolId: request.schoolId,
        status: "pending",
        scheduledFor: null,
        startedAt: null,
        submittedAt: null,
        autoSubmitted: false,
        timeSpentSeconds: null,
        answers: [],
        score: null,
        violationsCount: 0,
        warningsIssued: 0,
        recordings: { cameraPath: null, screenPath: null },
        gradedAt: null,
        feedback: null,
        retakeOf: request.attemptId,
        retakeAuthorizedBy: actor.uid,
        retakeSource: "request",
        retakeRequestId: requestId,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(newAttemptRef!, attempt);
    }

    tx.update(requestRef, {
      status: approve ? "approved" : "rejected",
      decidedBy: actor.uid,
      decidedAt: FieldValue.serverTimestamp(),
    });
    return { studentId: request.studentId, examId: request.examId };
  });

  const newAttemptId = newAttemptRef?.id ?? null;

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: approve ? "retake.approved" : "retake.rejected",
    targetType: "retake_request",
    targetId: requestId,
    meta: { newAttemptId },
  });

  // Tell the student the outcome (best-effort).
  void (async () => {
    try {
      const examTitle = (await getExamTitle(decided.examId)) ?? "your exam";
      await notifyUsers([decided.studentId], {
        type: approve ? "retake_approved" : "retake_rejected",
        title: approve ? `Retake approved: ${examTitle}` : `Retake request declined: ${examTitle}`,
        body: approve
          ? `Your retake request for “${examTitle}” was approved — the retake is waiting in My Exams.`
          : `Your retake request for “${examTitle}” was not approved. Contact your teacher to learn more.`,
        link: "/student/exams",
        actorId: actor.uid,
      });
    } catch (err) {
      console.error("[retakes] decision notification failed", err);
    }
  })();

  return { newAttemptId };
}

/**
 * One decision in a school's retake history — either an approve/reject of a
 * student request, or a direct staff grant from the results view.
 */
export interface RetakeDecisionEntry {
  id: string;
  studentId: string;
  examId: string;
  decision: "approved" | "rejected" | "granted";
  /** Who decided — the school sees names resolved against this uid. */
  decidedBy: string | null;
  decidedAt: FirestoreTimestamp | null;
  via: "request" | "direct";
}

/**
 * Retake decision history for the acting staff member, scoped like the pending
 * list: school admins see their school, teachers their classes' students,
 * standalone admins their own students, super admins everything.
 *
 * Merges both decision sources so nothing is invisible: decided entries of
 * `retake_requests` (approve/reject with `decidedBy`/`decidedAt`) plus
 * direct grants (attempts chained via `retakeOf`, authorized by
 * `retakeAuthorizedBy`).
 */
export async function listRetakeDecisionHistory(
  actor: SessionUser,
  limit = 50,
): Promise<RetakeDecisionEntry[]> {
  const maxResults = Math.max(1, Math.floor(limit));
  const entries: RetakeDecisionEntry[] = [];
  const allowedStudentIds = await decisionStudentScope(actor);

  // ── 1. Decided requests ──
  let requestQuery: Query<RetakeRequestDoc> = retakeRequestsCol()
    .where("status", "in", ["approved", "rejected"])
    .orderBy("createdAt", "desc");
  if (actor.role !== "super_admin") {
    if (actor.schoolId) {
      requestQuery = retakeRequestsCol()
        .where("schoolId", "==", actor.schoolId)
        .where("status", "in", ["approved", "rejected"])
        .orderBy("createdAt", "desc");
    } else if (actor.role === "admin") {
      requestQuery = retakeRequestsCol()
        .where("schoolId", "==", null)
        .where("status", "in", ["approved", "rejected"])
        .orderBy("createdAt", "desc");
    }
  }
  const requestDocs = await collectVisibleDocs(
    requestQuery,
    maxResults,
    allowedStudentIds,
  );
  requestDocs.forEach((d) => {
    const r = d.data();
    entries.push({
      id: `request-${d.id}`,
      studentId: r.studentId,
      examId: r.examId,
      decision: r.status as "approved" | "rejected",
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt ?? r.createdAt,
      via: "request",
    });
  });

  // ── 2. Direct grants (no request doc — the chained attempt is the record). ──
  let attemptQuery: Query<AttemptDoc> = attemptsCol()
    .where("retakeSource", "==", "direct")
    .orderBy("createdAt", "desc");
  if (actor.role !== "super_admin" && actor.schoolId) {
    attemptQuery = attemptsCol()
      .where("schoolId", "==", actor.schoolId)
      .where("retakeSource", "==", "direct")
      .orderBy("createdAt", "desc");
  } else if (actor.role === "admin") {
    attemptQuery = attemptsCol()
      .where("schoolId", "==", null)
      .where("retakeSource", "==", "direct")
      .orderBy("createdAt", "desc");
  }
  const attemptDocs = await collectVisibleDocs(
    attemptQuery,
    maxResults,
    allowedStudentIds,
  );
  attemptDocs.forEach((d) => {
    const a = d.data();
    entries.push({
      id: `grant-${d.id}`,
      studentId: a.studentId,
      examId: a.examId,
      decision: "granted",
      decidedBy: a.retakeAuthorizedBy,
      decidedAt: a.createdAt,
      via: "direct",
    });
  });

  return entries.sort(byDecidedAtDesc).slice(0, maxResults);
}

function byDecidedAtDesc(
  a: RetakeDecisionEntry,
  b: RetakeDecisionEntry,
): number {
  const at = a.decidedAt?.toMillis?.() ?? 0;
  const bt = b.decidedAt?.toMillis?.() ?? 0;
  return bt - at;
}

/** Student ids belonging to any of a teacher's assigned classes. */
async function teacherClassStudentIds(teacherUid: string): Promise<Set<string>> {
  const teacherSnap = await userDoc(teacherUid).get();
  const assigned = teacherSnap.exists ? (teacherSnap.data()!.assignedClassIds ?? []) : [];
  const ids = new Set<string>();
  const CHUNK = 10; // Firestore "in" ceiling
  for (let i = 0; i < assigned.length; i += CHUNK) {
    const chunk = assigned.slice(i, i + CHUNK);
    const snap = await usersCol().where("classId", "in", chunk).select("classId").get();
    snap.docs.forEach((d) => ids.add(d.id));
  }
  return ids;
}

async function decisionStudentScope(actor: SessionUser): Promise<Set<string> | null> {
  if (actor.role === "teacher") return teacherClassStudentIds(actor.uid);
  if (actor.role === "admin" && !actor.schoolId) {
    const snap = await usersCol()
      .where("role", "==", "student")
      .where("createdBy", "==", actor.uid)
      .select()
      .get();
    return new Set(snap.docs.map((d) => d.id));
  }
  return null;
}

async function collectVisibleDocs<T extends { studentId: string }>(
  baseQuery: Query<T>,
  maxResults: number,
  allowedStudentIds: ReadonlySet<string> | null,
): Promise<QueryDocumentSnapshot<T>[]> {
  if (!allowedStudentIds) {
    return (await baseQuery.limit(maxResults).get()).docs;
  }
  if (allowedStudentIds.size === 0) return [];

  const results: QueryDocumentSnapshot<T>[] = [];
  const pageSize = Math.max(100, Math.min(maxResults, 500));
  let cursor: QueryDocumentSnapshot<T> | null = null;
  while (results.length < maxResults) {
    let pageQuery = baseQuery.limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    for (const doc of page.docs) {
      if (allowedStudentIds.has(doc.data().studentId)) results.push(doc);
      if (results.length === maxResults) break;
    }
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) break;
  }
  return results;
}

/**
 * Pending retake requests visible to the acting staff member:
 * - school admin → every request in their school
 * - teacher → only requests from students in their assigned classes
 * - standalone admin → only requests from students they created
 * - super admin → everything
 */
export async function listPendingRetakeRequests(
  actor: SessionUser,
): Promise<WithId<RetakeRequestDoc>[]> {
  let query: Query<RetakeRequestDoc> = retakeRequestsCol()
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc");
  if ((actor.role === "admin" || actor.role === "teacher") && actor.schoolId) {
    query = retakeRequestsCol()
      .where("status", "==", "pending")
      .where("schoolId", "==", actor.schoolId)
      .orderBy("createdAt", "desc");
  } else if (actor.role === "admin") {
    // Standalone (parent/tutor) admin: requests live under schoolId null.
    query = retakeRequestsCol()
      .where("status", "==", "pending")
      .where("schoolId", "==", null)
      .orderBy("createdAt", "desc");
  }
  const allowedStudentIds = await decisionStudentScope(actor);
  const docs = await collectVisibleDocs(query, 100, allowedStudentIds);
  return docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/**
 * Staff grant a retake directly, without waiting for the student to ask —
 * "allow students to reattempt the exam". Creates a fresh pending attempt
 * chained to the original via `retakeOf`.
 */
export async function authorizeRetake(
  actor: SessionUser,
  attemptId: string,
): Promise<{ newAttemptId: string }> {
  if (actor.role !== "admin" && actor.role !== "super_admin" && actor.role !== "teacher") {
    throw new RetakesServiceError("Not allowed.", 403);
  }
  const newAttemptRef = attemptsCol().doc();
  const granted = await adminDb().runTransaction(async (tx) => {
    const originalSnap = await tx.get(attemptDoc(attemptId));
    if (!originalSnap.exists) throw new RetakesServiceError("Attempt not found.", 404);
    const original = originalSnap.data()!;
    // Same decision rights as request-based approvals.
    const studentSnap = await tx.get(userDoc(original.studentId));
    if (!studentSnap.exists) {
      throw new RetakesServiceError("Student not found.", 404);
    }
    const student = studentSnap.data()!;
    if (actor.role === "teacher") {
      const teacherSnap = await tx.get(userDoc(actor.uid));
      const assigned = teacherSnap.exists ? (teacherSnap.data()!.assignedClassIds ?? []) : [];
      if (!student.classId || !assigned.includes(student.classId)) {
        throw new RetakesServiceError("This student is not in one of your classes.", 403);
      }
    } else if (actor.role === "admin") {
      if (actor.schoolId) {
        if (original.schoolId !== actor.schoolId) {
          throw new RetakesServiceError("This student belongs to another school.", 403);
        }
      } else if (original.schoolId != null || student.createdBy !== actor.uid) {
        throw new RetakesServiceError("This student was not created by you.", 403);
      }
    }
    if (original.status !== "graded" && original.status !== "flagged") {
      throw new RetakesServiceError(
        "Retakes can be granted once results are out.",
        409,
      );
    }
    const examSnap = await tx.get(examDoc(original.examId));
    if (examSnap.exists) {
      const expiresAt = examSnap.data()!.expiresAt ?? null;
      if (expiresAt && expiresAt.toMillis() <= Date.now()) {
        throw new RetakesServiceError("This exam has passed its deadline.", 409);
      }
    }

    const openQuery = attemptsCol().where("retakeOf", "==", attemptId);
    const openSnap = await tx.get(openQuery);
    for (const retakeDoc of openSnap.docs) {
      const retake = retakeDoc.data();
      if (retake.studentId !== original.studentId) continue;
      if (
        retake.status === "pending" ||
        retake.status === "in_progress" ||
        retake.status === "submitted"
      ) {
        throw new RetakesServiceError(
          "An open retake already exists for this exam — the student must complete it first.",
          409,
        );
      }
    }

    const now = FieldValue.serverTimestamp();
    const attempt: WriteModel<AttemptDoc> = {
      examId: original.examId,
      studentId: original.studentId,
      schoolId: original.schoolId,
      status: "pending",
      scheduledFor: null,
      startedAt: null,
      submittedAt: null,
      autoSubmitted: false,
      timeSpentSeconds: null,
      answers: [],
      score: null,
      violationsCount: 0,
      warningsIssued: 0,
      recordings: { cameraPath: null, screenPath: null },
      gradedAt: null,
      feedback: null,
      retakeOf: attemptId,
      retakeAuthorizedBy: actor.uid,
      retakeSource: "direct",
      retakeRequestId: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(newAttemptRef, attempt);
    return { studentId: original.studentId, examId: original.examId };
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "retake.granted",
    targetType: "attempt",
    targetId: attemptId,
    meta: { newAttemptId: newAttemptRef.id },
  });

  void (async () => {
    try {
      const examTitle = (await getExamTitle(granted.examId)) ?? "your exam";
      await notifyUsers([granted.studentId], {
        type: "retake_approved",
        title: `Retake granted: ${examTitle}`,
        body: `Your teacher granted you a retake for “${examTitle}” — it is waiting in My Exams.`,
        link: "/student/exams",
        actorId: actor.uid,
      });
    } catch (err) {
      console.error("[retakes] grant notification failed", err);
    }
  })();

  return { newAttemptId: newAttemptRef.id };
}

export async function getExamTitle(examId: string): Promise<string | null> {
  const snap = await examDoc(examId).get();
  return snap.exists ? snap.data()!.title : null;
}

/** Whether the student already has a pending retake request for this attempt. */
export async function hasPendingRetakeRequest(
  attemptId: string,
  studentId: string,
): Promise<boolean> {
  const snap = await retakeRequestsCol()
    .where("attemptId", "==", attemptId)
    .where("studentId", "==", studentId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return !snap.empty;
}

/** Whether the student has an open (not yet graded/flagged) retake attempt for this original attempt. */
export async function hasOpenRetakeAttempt(
  attemptId: string,
  studentId: string,
): Promise<boolean> {
  const snap = await attemptsCol()
    .where("retakeOf", "==", attemptId)
    .limit(20)
    .get();
  for (const d of snap.docs) {
    const a = d.data() as import("@/types/firestore").AttemptDoc;
    if (a.studentId !== studentId) continue;
    if (a.status === "pending" || a.status === "in_progress" || a.status === "submitted") return true;
  }
  return false;
}

/** Retake counts per exam for a given school/owner — approved retakes only (Attempt.retakeOf != null). */
export async function getRetakeCountsByExam(
  actor: SessionUser,
): Promise<Map<string, number>> {
  let query: Query<AttemptDoc> = attemptsCol();
  if (actor.schoolId && (actor.role === "admin" || actor.role === "teacher")) {
    query = query.where("schoolId", "==", actor.schoolId);
  } else if (actor.role === "admin" || actor.role === "teacher") {
    query = query.where("schoolId", "==", null);
  }
  return aggregateRetakesByExam(query, 1_000);
}

/** For a student, retake counts per examId. */
export async function getStudentRetakeCounts(
  studentId: string,
): Promise<Map<string, number>> {
  return aggregateRetakesByExam(
    attemptsCol().where("studentId", "==", studentId),
    200,
  );
}

async function aggregateRetakesByExam(
  baseQuery: Query<AttemptDoc>,
  pageSize: number,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot<AttemptDoc> | null = null;
  while (true) {
    let pageQuery = baseQuery
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();
    for (const attemptDoc of page.docs) {
      const attempt = attemptDoc.data();
      if (attempt.retakeOf) {
        map.set(attempt.examId, (map.get(attempt.examId) ?? 0) + 1);
      }
    }
    if (page.size < pageSize) break;
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) break;
  }
  return map;
}
