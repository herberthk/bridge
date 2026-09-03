import { Timestamp } from "firebase-admin/firestore";

import {
  attemptDoc,
  countQuery,
  examDoc,
  examsCol,
} from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type { AttemptDoc, ExamDoc, WithId } from "@/types/firestore";
import { ExamsServiceError } from "./errors";

export interface ExamListResult {
  exams: WithId<ExamDoc>[];
  partial: boolean;
  ordered: boolean;
}

function examsForActor(actor: SessionUser): FirebaseFirestore.Query<ExamDoc> {
  if ((actor.role === "admin" || actor.role === "teacher") && actor.schoolId) {
    return examsCol().where("schoolId", "==", actor.schoolId);
  }
  if (actor.role === "admin" || actor.role === "teacher") {
    return examsCol().where("createdBy", "==", actor.uid);
  }
  return examsCol();
}

function examFromSnapshot(
  doc: FirebaseFirestore.QueryDocumentSnapshot<ExamDoc>,
): WithId<ExamDoc> {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data?.createdAt ?? (doc.createTime as unknown as Timestamp),
    updatedAt:
      data?.updatedAt ??
      (doc.updateTime as unknown as Timestamp) ??
      data?.createdAt ??
      (doc.createTime as unknown as Timestamp),
  };
}

/** Exact exam total for dashboard KPIs, independent of display limits. */
export async function countExams(actor: SessionUser): Promise<number> {
  return countQuery(examsForActor(actor));
}

/**
 * Most recent exams for the supplied classes. Pages through the actor-scoped
 * ordered query so busy schools cannot push all matching exams past a fixed
 * initial batch.
 */
export async function listRecentExamsForClasses(
  actor: SessionUser,
  classIds: string[],
  limit = 5,
): Promise<WithId<ExamDoc>[]> {
  const wanted = new Set(classIds);
  if (wanted.size === 0 || limit <= 0) return [];

  const batchSize = 100;
  const ordered = examsForActor(actor).orderBy("createdAt", "desc");
  const matches: WithId<ExamDoc>[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot<ExamDoc> | undefined;

  while (matches.length < limit) {
    const query = cursor
      ? ordered.startAfter(cursor).limit(batchSize)
      : ordered.limit(batchSize);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const exam = examFromSnapshot(doc);
      if (exam.classId && wanted.has(exam.classId)) matches.push(exam);
      if (matches.length === limit) break;
    }
    if (snap.size < batchSize) break;
    cursor = snap.docs.at(-1);
  }

  return matches;
}

export async function listExams(
  actor: SessionUser,
  limit = 200,
): Promise<ExamListResult> {
  const query = examsForActor(actor).orderBy("createdAt", "desc").limit(limit);
  let snap: FirebaseFirestore.QuerySnapshot<ExamDoc>;
  let usedFallback = false;
  try {
    snap = await query.get();
  } catch (error) {
    usedFallback = true;
    console.error("[exams] ordered exam query failed; using a partial, unordered fallback", {
      actorId: actor.uid,
      actorRole: actor.role,
      schoolId: actor.schoolId ?? null,
      limit,
      error,
    });
    snap = await examsForActor(actor).limit(limit).get();
  }
  const exams = snap.docs.map(examFromSnapshot);
  return { exams, partial: usedFallback, ordered: !usedFallback };
}

export async function getExamForActor(
  actor: SessionUser,
  examId: string,
): Promise<WithId<ExamDoc>> {
  const snap = await examDoc(examId).get();
  if (!snap.exists) throw new ExamsServiceError("Exam not found.", 404);
  const exam = { id: snap.id, ...snap.data()! } as WithId<ExamDoc>;
  const allowed =
    actor.role === "super_admin" ||
    ((actor.role === "admin" || actor.role === "teacher") &&
      (exam.createdBy === actor.uid || (exam.schoolId && exam.schoolId === actor.schoolId))) ||
    (actor.role === "student" && exam.schoolId && exam.schoolId === actor.schoolId);
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return exam;
}

export async function getAttemptForActor(
  actor: SessionUser,
  attemptId: string,
): Promise<WithId<AttemptDoc>> {
  const snap = await attemptDoc(attemptId).get();
  if (!snap.exists) throw new ExamsServiceError("Attempt not found.", 404);
  const attempt = { id: snap.id, ...snap.data()! } as WithId<AttemptDoc>;
  const allowed =
    actor.role === "super_admin" ||
    attempt.studentId === actor.uid ||
    ((actor.role === "admin" || actor.role === "teacher") &&
      attempt.schoolId !== null &&
      attempt.schoolId === actor.schoolId);
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return attempt;
}
