import { Timestamp } from "firebase-admin/firestore";

import {
  attemptDoc,
  classDoc,
  classesBySchool,
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

async function assignedClassIdsForTeacher(actor: SessionUser): Promise<Set<string>> {
  if (actor.role !== "teacher" || !actor.schoolId) return new Set();
  const snap = await classesBySchool(actor.schoolId).get();
  return new Set(
    snap.docs
      .filter((doc) => (doc.data().teacherIds ?? []).includes(actor.uid))
      .map((doc) => doc.id),
  );
}

async function teacherCanAccessExam(actor: SessionUser, exam: ExamDoc): Promise<boolean> {
  if (actor.role !== "teacher" || !actor.schoolId || !exam.classId) return false;
  const snap = await classDoc(exam.classId).get();
  if (!snap.exists) return false;
  const cls = snap.data()!;
  return cls.schoolId === actor.schoolId && (cls.teacherIds ?? []).includes(actor.uid);
}

async function teacherCanAccessAttempt(
  actor: SessionUser,
  attempt: AttemptDoc,
): Promise<boolean> {
  if (!actor.schoolId || attempt.schoolId !== actor.schoolId) return false;
  const snap = await examDoc(attempt.examId).get();
  return snap.exists && teacherCanAccessExam(actor, snap.data()!);
}

function teacherExamQueries(
  actor: SessionUser,
  classIds: string[],
): FirebaseFirestore.Query<ExamDoc>[] {
  if (!actor.schoolId) return [];
  const queries: FirebaseFirestore.Query<ExamDoc>[] = [];
  for (let i = 0; i < classIds.length; i += 10) {
    queries.push(
      examsCol()
        .where("schoolId", "==", actor.schoolId)
        .where("classId", "in", classIds.slice(i, i + 10)),
    );
  }
  return queries;
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
  if (actor.role === "teacher") {
    const classIds = [...(await assignedClassIdsForTeacher(actor))];
    const counts = await Promise.all(
      teacherExamQueries(actor, classIds).map((query) => countQuery(query)),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }
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
  if (actor.role === "teacher") {
    const assigned = await assignedClassIdsForTeacher(actor);
    for (const classId of wanted) {
      if (!assigned.has(classId)) wanted.delete(classId);
    }
  }
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
  const assignedClassIds =
    actor.role === "teacher" ? await assignedClassIdsForTeacher(actor) : null;
  const baseQueries =
    assignedClassIds === null
      ? [examsForActor(actor)]
      : teacherExamQueries(actor, [...assignedClassIds]);
  if (baseQueries.length === 0 || limit <= 0) {
    return { exams: [], partial: false, ordered: true };
  }
  let snaps: FirebaseFirestore.QuerySnapshot<ExamDoc>[];
  let usedFallback = false;
  try {
    snaps = await Promise.all(
      baseQueries.map((query) => query.orderBy("createdAt", "desc").limit(limit).get()),
    );
  } catch (error) {
    usedFallback = true;
    console.error("[exams] ordered exam query failed; using a partial, unordered fallback", {
      actorId: actor.uid,
      actorRole: actor.role,
      schoolId: actor.schoolId ?? null,
      limit,
      error,
    });
    snaps = await Promise.all(baseQueries.map((query) => query.limit(limit).get()));
  }
  const exams = snaps
    .flatMap((snap) => snap.docs)
    .map(examFromSnapshot)
    .filter(
      (exam) =>
        assignedClassIds === null ||
        (exam.classId !== null && exam.classId !== undefined && assignedClassIds.has(exam.classId)),
    )
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    .slice(0, limit);
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
    (actor.role === "admin" &&
      (exam.createdBy === actor.uid || (exam.schoolId && exam.schoolId === actor.schoolId))) ||
    (actor.role === "student" && exam.schoolId && exam.schoolId === actor.schoolId) ||
    (actor.role === "teacher" && (await teacherCanAccessExam(actor, exam)));
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
    (actor.role === "student" && attempt.studentId === actor.uid) ||
    (actor.role === "admin" &&
      attempt.schoolId !== null &&
      attempt.schoolId === actor.schoolId) ||
    (actor.role === "teacher" && (await teacherCanAccessAttempt(actor, attempt)));
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return attempt;
}
