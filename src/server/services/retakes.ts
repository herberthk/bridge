import { FieldValue } from "firebase-admin/firestore";

import {
  attemptDoc,
  attemptsCol,
  examDoc,
  retakeRequestDoc,
  retakeRequestsCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, RetakeRequestDoc, WriteModel } from "@/types/firestore";

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

  // One open request per attempt.
  const existing = await retakeRequestsCol()
    .where("attemptId", "==", attemptId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new RetakesServiceError("A retake request is already pending for this exam.", 409);
  }

  // Enforce: if admin already approved a retake for this attempt, the student must complete that
  // retake attempt before requesting again. Check for an open retake attempt (pending/in_progress/submitted)
  // where retakeOf == attemptId. This prevents spamming requests before the approved retake is finished.
  // Query by retakeOf only (single-field index) then filter studentId/status client-side to avoid composite index.
  const openRetakeSnap = await attemptsCol()
    .where("retakeOf", "==", attemptId)
    .limit(20)
    .get();
  for (const d of openRetakeSnap.docs) {
    const ra = d.data() as import("@/types/firestore").AttemptDoc;
    if (ra.studentId !== actor.uid) continue;
    if (ra.status === "pending" || ra.status === "in_progress" || ra.status === "submitted") {
      throw new RetakesServiceError("You already have an approved retake for this exam — complete it before requesting another.", 409);
    }
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
  const ref = await retakeRequestsCol().add(doc);
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
  const snap = await retakeRequestDoc(requestId).get();
  if (!snap.exists) throw new RetakesServiceError("Request not found.", 404);
  const request = snap.data()!;
  if (request.status !== "pending") {
    throw new RetakesServiceError("This request was already decided.", 409);
  }
  if (actor.role === "admin" && actor.schoolId && request.schoolId !== actor.schoolId) {
    throw new RetakesServiceError("This student belongs to another school.", 403);
  }

  await retakeRequestDoc(requestId).update({
    status: approve ? "approved" : "rejected",
    decidedBy: actor.uid,
    decidedAt: FieldValue.serverTimestamp(),
  });

  let newAttemptId: string | null = null;
  if (approve) {
    // Defensive: also block approval if an open retake already exists (race / duplicate approve)
    const openCheck = await attemptsCol()
      .where("retakeOf", "==", request.attemptId)
      .limit(20)
      .get();
    for (const d of openCheck.docs) {
      const ra = d.data() as import("@/types/firestore").AttemptDoc;
      if (ra.studentId !== request.studentId) continue;
      if (ra.status === "pending" || ra.status === "in_progress" || ra.status === "submitted") {
        throw new RetakesServiceError("An approved retake is already pending for this exam — student must complete it first.", 409);
      }
    }
    const now = FieldValue.serverTimestamp();
    const attempt: WriteModel<import("@/types/firestore").AttemptDoc> = {
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
    const ref = await attemptsCol().add(attempt);
    newAttemptId = ref.id;
  }

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
  let q = attemptsCol().limit(1000);
  if (actor.schoolId) q = attemptsCol().where("schoolId", "==", actor.schoolId).limit(1000);
  else if (actor.role === "admin") q = attemptsCol().where("schoolId", "==", null).limit(1000);
  // Firestore cannot filter != null on retakeOf without index; fetch and filter client-side for now (1000 cap)
  const snap = await q.get();
  const map = new Map<string, number>();
  for (const d of snap.docs) {
    const data = d.data() as import("@/types/firestore").AttemptDoc;
    if (data.retakeOf !== null && (data.retakeOf as unknown as string) !== undefined && data.retakeOf !== "") {
      map.set(data.examId, (map.get(data.examId) ?? 0) + 1);
    }
  }
  return map;
}

/** For a student, retake counts per examId. */
export async function getStudentRetakeCounts(
  studentId: string,
): Promise<Map<string, number>> {
  const snap = await attemptsCol().where("studentId", "==", studentId).limit(200).get();
  const map = new Map<string, number>();
  for (const d of snap.docs) {
    const data = d.data() as import("@/types/firestore").AttemptDoc;
    if (data.retakeOf) map.set(data.examId, (map.get(data.examId) ?? 0) + 1);
  }
  return map;
}
