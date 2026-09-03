import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  attemptsCol,
  classDoc,
  examDoc,
  usersCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { notifyUsers } from "@/server/services/notifications";
import { formatExpiry, isExamExpired } from "@/lib/exam/expiry";
import { isAssignGated, readReview, reviewProgress } from "@/lib/exam/review";
import type { SessionUser } from "@/server/auth/session";
import type { AttemptDoc, ExamDoc, WriteModel } from "@/types/firestore";
import type { AssignExamInput } from "@/lib/schemas/exam";
import { ExamsServiceError } from "./errors";
import { getExamForActor } from "./library";

/** Returns student IDs who already have an attempt for this exam */
export async function getAssignedStudentIdsForExam(
  actor: SessionUser,
  examId: string,
): Promise<string[]> {
  if (actor.role !== "admin" && actor.role !== "super_admin" && actor.role !== "teacher") {
    throw new ExamsServiceError("Not allowed.", 403);
  }
  if (actor.role === "teacher") await getExamForActor(actor, examId);
  let query = attemptsCol().where("examId", "==", examId);
  if ((actor.role === "admin" || actor.role === "teacher") && actor.schoolId) {
    query = query.where("schoolId", "==", actor.schoolId);
  }
  const snap = await query.select("studentId").get();
  const ids = new Set<string>();
  snap.docs.forEach((d) => {
    const sid = d.data().studentId as string;
    if (sid) ids.add(sid);
  });
  return Array.from(ids);
}

/** Assign an exam to students → creates pending attempts (optionally scheduled). */
export async function assignExam(
  actor: SessionUser,
  input: AssignExamInput,
): Promise<number> {
  if (actor.role !== "admin" && actor.role !== "super_admin" && actor.role !== "teacher") {
    throw new ExamsServiceError("Not allowed.", 403);
  }
  const examSnap = await examDoc(input.examId).get();
  if (!examSnap.exists) throw new ExamsServiceError("Exam not found.", 404);
  const exam = examSnap.data()!;
  if (
    (actor.role === "admin" || actor.role === "teacher") &&
    exam.schoolId &&
    exam.schoolId !== actor.schoolId
  ) {
    throw new ExamsServiceError("This exam belongs to another school.", 403);
  }
  if (isExamExpired({ expiresAt: exam.expiresAt ?? null })) {
    throw new ExamsServiceError(
      `This exam closed on ${formatExpiry({ expiresAt: exam.expiresAt ?? null }) ?? "its deadline"}.`,
      409,
    );
  }

  // Teachers manage only their assigned classes: the exam's class must be one
  // of theirs, and invited students must belong to that same class.
  if (actor.role === "teacher") {
    if (!exam.classId) {
      throw new ExamsServiceError("This exam is not tied to one of your classes.", 403);
    }
    const classSnap = await classDoc(exam.classId).get();
    if (!classSnap.exists || classSnap.data()!.schoolId !== actor.schoolId) {
      throw new ExamsServiceError("This exam's class belongs to another school.", 403);
    }
    if (!(classSnap.data()!.teacherIds ?? []).includes(actor.uid)) {
      throw new ExamsServiceError("You are not assigned to this exam's class.", 403);
    }
  }

  /**
   * The review gate.
   *
   * Enforced here rather than only in the UI because the assign dialog is not the
   * only caller — a stale tab, a replayed form post and a future bulk-assign all
   * arrive at this function, and "the button was disabled" is not a permission.
   *
   * `isAssignGated` limits this to `draft` exams: anything already `scheduled` or
   * `active` was assigned before this screen existed, so gating it now would fault
   * work that was legitimate when it was done.
   */
  const assertReviewGate = (
    candidate: Pick<ExamDoc, "status" | "questions" | "review">,
  ): boolean => {
    const candidateGated = isAssignGated(candidate);
    if (candidateGated && !input.acknowledgeUnreviewed) {
      const { approved, total } = reviewProgress(candidate.questions, candidate.review);
      throw new ExamsServiceError(
        `Review the questions before assigning — ${approved} of ${total} approved.`,
        409,
      );
    }
    return candidateGated;
  };
  assertReviewGate(exam);

  // Enforce that every referenced student actually belongs to this admin
  // (same school / standalone household). Prevents assigning exams to
  // arbitrary student ids across the platform.
  // Firestore "in" queries accept max 10 values (was 30 in older SDKs).
  // Chunks are independent reads, so they fan out concurrently.
  const CHUNK = 10;
  const buildStudentQuery = (chunk: string[]) => {
    let query = usersCol().where("role", "==", "student");
    if ((actor.role === "admin" || actor.role === "teacher") && actor.schoolId) {
      query = query.where("schoolId", "==", actor.schoolId);
    } else if (actor.role === "admin") {
      query = query.where("createdBy", "==", actor.uid);
    }
    // Teachers invite students from their exam's class only.
    if (actor.role === "teacher" && exam.classId) {
      query = query.where("classId", "==", exam.classId);
    }
    return query.where(FieldPath.documentId(), "in", chunk).get();
  };
  const chunks: string[][] = [];
  for (let i = 0; i < input.studentIds.length; i += CHUNK) {
    chunks.push(input.studentIds.slice(i, i + CHUNK));
  }
  const allowedIds = new Set<string>();
  (await Promise.all(chunks.map(buildStudentQuery))).forEach((snap) =>
    snap.docs.forEach((d) => allowedIds.add(d.id)),
  );
  const rejected = input.studentIds.filter((id) => !allowedIds.has(id));
  if (rejected.length > 0) {
    throw new ExamsServiceError(
      `${rejected.length} selected student(s) are not in your school.`,
      403,
    );
  }

  let scheduledAt: Timestamp | null = null;
  if (input.scheduledFor) {
    const parsedMs = Date.parse(input.scheduledFor);
    if (isNaN(parsedMs)) {
      throw new ExamsServiceError("Invalid scheduledFor date.", 400);
    }
    scheduledAt = Timestamp.fromMillis(parsedMs);
    if (exam.expiresAt && scheduledAt.toMillis() > exam.expiresAt.toMillis()) {
      throw new ExamsServiceError("The scheduled start must be on or before the exam deadline.", 400);
    }
  }
  // The exam status is the question-edit lock. Reading it, creating attempts and
  // leaving draft in one transaction means `saveQuestions` cannot commit between
  // the first attempt write and the status transition.
  const assignment = await adminDb().runTransaction(async (tx) => {
    const lockedExamRef = examDoc(input.examId);
    const lockedExamSnap = await tx.get(lockedExamRef);
    if (!lockedExamSnap.exists) throw new ExamsServiceError("Exam not found.", 404);
    const lockedExam = lockedExamSnap.data()!;
    if (
      (actor.role === "admin" || actor.role === "teacher") &&
      lockedExam.schoolId &&
      lockedExam.schoolId !== actor.schoolId
    ) {
      throw new ExamsServiceError("This exam belongs to another school.", 403);
    }
    const gated = assertReviewGate(lockedExam);

    // Skip students who already have an open/unfinished attempt for this exam.
    // These reads share the transaction with the writes, preventing two concurrent
    // assignments from creating duplicate open attempts. All reads complete
    // before any write below, so they fan out concurrently.
    const openStatuses: readonly AttemptDoc["status"][] = [
      "pending",
      "in_progress",
      "submitted",
    ];
    const existingSnaps = await Promise.all(
      chunks.map((chunk) =>
        tx.get(
          attemptsCol()
            .where("examId", "==", input.examId)
            .where("studentId", "in", chunk),
        ),
      ),
    );
    const hasOpenAttempt = new Set<string>();
    existingSnaps.forEach((existing) =>
      existing.docs.forEach((d) => {
        const attempt = d.data();
        if (openStatuses.includes(attempt.status)) hasOpenAttempt.add(attempt.studentId);
      }),
    );

    const studentIds = input.studentIds.filter((id) => !hasOpenAttempt.has(id));
    if (studentIds.length === 0) return { created: 0, gated, assignedIds: [] as string[] };

    // The preflight expiry check can race the transaction. Re-check the locked
    // document after every read and immediately before creating attempts.
    if (isExamExpired({ expiresAt: lockedExam.expiresAt ?? null })) {
      throw new ExamsServiceError(
        `This exam closed on ${formatExpiry({ expiresAt: lockedExam.expiresAt ?? null }) ?? "its deadline"}.`,
        409,
      );
    }
    if (
      scheduledAt &&
      lockedExam.expiresAt &&
      scheduledAt.toMillis() > lockedExam.expiresAt.toMillis()
    ) {
      throw new ExamsServiceError("The scheduled start must be on or before the exam deadline.", 400);
    }

    const now = FieldValue.serverTimestamp();
    const base: WriteModel<AttemptDoc> = {
      examId: input.examId,
      studentId: "",
      schoolId: lockedExam.schoolId,
      status: "pending",
      scheduledFor: scheduledAt,
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
      retakeOf: null,
      retakeAuthorizedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    for (const studentId of studentIds) {
      tx.create(attemptsCol().doc(), { ...base, studentId });
    }

    const nextStatus = lockedExam.status === "draft" ? "scheduled" : lockedExam.status;
    // Stamp the override on the document, not just the audit log. The library and
    // the review screen both show whether an exam went out unreviewed, and an admin
    // looking at a paper a student is already sitting should not have to read the
    // audit trail to find that out.
    //
    // Written as a whole `review` object rather than as `review.overriddenAt` dotted
    // paths: the field is optional on `ExamDoc`, so a dotted update would not
    // typecheck against `UpdateData<ExamDoc>`.
    if (gated) {
      const stampedAt = new Date().toISOString();
      tx.update(lockedExamRef, {
        status: nextStatus,
        review: {
          ...readReview(lockedExam.review),
          overriddenAt: stampedAt,
          updatedAt: stampedAt,
        },
        updatedAt: now,
      });
    } else {
      tx.update(lockedExamRef, { status: nextStatus, updatedAt: now });
    }

    return { created: studentIds.length, gated, assignedIds: studentIds };
  });
  const { created, gated, assignedIds } = assignment;

  // Notify the invited students (best-effort — never blocks the assignment).
  if (created > 0 && assignedIds.length > 0) {
    void notifyUsers(assignedIds, {
      type: "exam_assigned",
      title: `New exam: ${exam.title}`,
      body: exam.expiresAt
        ? `You have been assigned “${exam.title}”. It closes on ${formatExpiry({ expiresAt: exam.expiresAt ?? null }) ?? "its deadline"}.`
        : `You have been assigned “${exam.title}”. Good luck!`,
      link: `/student/exams/${input.examId}`,
      actorId: actor.uid,
    });
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "exam.assigned",
    targetType: "exam",
    targetId: input.examId,
    meta: {
      students: created,
      scheduledFor: input.scheduledFor,
      ...(gated && created > 0 ? { unreviewedOverride: true } : {}),
    },
  });

  return created;
}
