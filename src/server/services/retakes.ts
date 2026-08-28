import { FieldPath, FieldValue, type Query } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  attemptDoc,
  attemptsCol,
  examDoc,
  retakeRequestDoc,
  retakeRequestsCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptDoc,
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
  return { id: ref.id, ...(doc as RetakeRequestDoc) };
}

/** Admin approves/rejects; approval creates a fresh pending attempt. */
export async function decideRetake(
  actor: SessionUser,
  requestId: string,
  approve: boolean,
): Promise<{ newAttemptId: string | null }> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new RetakesServiceError("Not allowed.", 403);
  }
  const requestRef = retakeRequestDoc(requestId);
  const newAttemptRef = approve ? attemptsCol().doc() : null;
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) throw new RetakesServiceError("Request not found.", 404);
    const request = snap.data()!;
    if (request.status !== "pending") {
      throw new RetakesServiceError("This request was already decided.", 409);
    }
    if (actor.role === "admin" && actor.schoolId && request.schoolId !== actor.schoolId) {
      throw new RetakesServiceError("This student belongs to another school.", 403);
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

  return { newAttemptId };
}

/** Pending retake requests visible to an admin (their school only). */
export async function listPendingRetakeRequests(
  actor: SessionUser,
): Promise<WithId<RetakeRequestDoc>[]> {
  let query = retakeRequestsCol()
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(100);
  if (actor.role === "admin" && actor.schoolId) {
    query = retakeRequestsCol()
      .where("status", "==", "pending")
      .where("schoolId", "==", actor.schoolId)
      .orderBy("createdAt", "desc")
      .limit(100);
  }
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
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
  if (actor.schoolId) query = query.where("schoolId", "==", actor.schoolId);
  else if (actor.role === "admin") query = query.where("schoolId", "==", null);
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
