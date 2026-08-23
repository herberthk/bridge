import { FieldValue } from "firebase-admin/firestore";

import {
  attemptsCol,
  examDoc,
  proctoringEventsCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { attemptDoc as attemptRef } from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptAnswer,
  AttemptDoc,
  ExamDoc,
  GradedAnswer,
  ProctoringEventDoc,
  Question,
  WithId,
  WriteModel,
} from "@/types/firestore";
import type {
  ProctorEventInput,
  SafeQuestion,
  StartedExam,
  SubmitAttemptInput,
} from "@/lib/schemas/attempt";
import { normalizeAnswer } from "@/lib/schemas/attempt";
import { PROCTORING } from "@/lib/constants";

export class AttemptsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

async function loadAttempt(attemptId: string): Promise<WithId<AttemptDoc>> {
  const snap = await attemptRef(attemptId).get();
  if (!snap.exists) throw new AttemptsServiceError("Attempt not found.", 404);
  return { id: snap.id, ...snap.data()! } as WithId<AttemptDoc>;
}

async function loadExam(examId: string): Promise<WithId<ExamDoc>> {
  const snap = await examDoc(examId).get();
  if (!snap.exists) throw new AttemptsServiceError("Exam not found.", 404);
  return { id: snap.id, ...snap.data()! } as WithId<ExamDoc>;
}

/** Start a pending attempt — enforces schedule windows, returns safe questions. */
export async function startAttempt(
  actor: SessionUser,
  attemptId: string,
): Promise<StartedExam> {
  if (actor.role !== "student") {
    throw new AttemptsServiceError("Only students take exams.", 403);
  }
  const attempt = await loadAttempt(attemptId);
  if (attempt.studentId !== actor.uid) {
    throw new AttemptsServiceError("This attempt belongs to another student.", 403);
  }
  if (attempt.status === "flagged") {
    throw new AttemptsServiceError(
      "This attempt was flagged for review. Contact your teacher.",
      403,
    );
  }
  if (
    attempt.status === "submitted" ||
    attempt.status === "graded"
  ) {
    throw new AttemptsServiceError("This exam was already submitted.", 409);
  }

  const exam = await loadExam(attempt.examId);

  if (attempt.status === "pending") {
    if (attempt.scheduledFor) {
      const opensAt = attempt.scheduledFor.toMillis() - 5 * 60_000; // 5-min grace
      if (Date.now() < opensAt) {
        throw new AttemptsServiceError(
          `This exam opens at ${attempt.scheduledFor.toDate().toLocaleString()}.`,
          403,
        );
      }
    }
    const now = FieldValue.serverTimestamp();
    await attemptRef(attemptId).update({
      status: "in_progress",
      startedAt: now,
      updatedAt: now,
    });
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "attempt.started",
      targetType: "attempt",
      targetId: attemptId,
    });
  }

  const startedMs = attempt.startedAt?.toMillis() ?? Date.now();
  const deadlineMs = startedMs + exam.params.durationMinutes * 60_000;

  return {
    attemptId,
    examTitle: exam.title,
    subject: exam.params.subject,
    durationMinutes: exam.params.durationMinutes,
    deadlineMs,
    questions: exam.questions.map(toSafeQuestion),
  };
}

function toSafeQuestion(q: Question): SafeQuestion {
  return {
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    pairs: q.pairs,
    points: q.points,
    hint: q.hint,
  };
}

/**
 * Submit an attempt. Deadline is enforced server-side: late submissions are
 * still accepted but marked auto-submitted. Objective questions are graded
 * deterministically; essays await AI grading (grading service).
 */
export async function submitAttempt(
  actor: SessionUser,
  attemptId: string,
  input: SubmitAttemptInput,
): Promise<{ status: AttemptDoc["status"]; needsAiGrading: boolean }> {
  const attempt = await loadAttempt(attemptId);
  if (attempt.studentId !== actor.uid) {
    throw new AttemptsServiceError("This attempt belongs to another student.", 403);
  }
  if (attempt.status === "submitted" || attempt.status === "graded") {
    return { status: attempt.status, needsAiGrading: false };
  }
  if (attempt.status === "flagged") {
    throw new AttemptsServiceError("This attempt is locked for review.", 403);
  }

  const exam = await loadExam(attempt.examId);
  const now = Date.now();
  const startedMs = attempt.startedAt?.toMillis() ?? now;
  const deadlineMs = startedMs + exam.params.durationMinutes * 60_000;
  const late = now > deadlineMs + 2_000; // 2s network grace

  const answers = gradeAnswers(exam.questions, input.answers);
  const objective = answers.filter((a) => a.graded !== null);
  const earned = objective.reduce((n, a) => n + (a.graded?.earned ?? 0), 0);
  const possibleTotal = exam.questions.reduce((n, q) => n + q.points, 0);
  const needsAiGrading = answers.some(
    (a) => a.graded === null && a.response !== null,
  );

  const ts = FieldValue.serverTimestamp();
  await attemptRef(attemptId).update({
    status: "submitted",
    answers,
    submittedAt: ts,
    autoSubmitted: input.autoSubmitted || late,
    timeSpentSeconds: Math.min(
      input.timeSpentSeconds,
      Math.round((now - startedMs) / 1000),
    ),
    score:
      !needsAiGrading && possibleTotal > 0
        ? {
            earned,
            possible: possibleTotal,
            percentage: Math.round((earned / possibleTotal) * 100),
          }
        : null,
    updatedAt: ts,
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: input.autoSubmitted || late ? "attempt.auto_submitted" : "attempt.submitted",
    targetType: "attempt",
    targetId: attemptId,
    meta: { late, questions: answers.length },
  });

  return { status: "submitted", needsAiGrading };
}

/** Deterministic grading for objective questions (pure — unit-tested). */
export function gradeAnswers(
  questions: Question[],
  submitted: SubmitAttemptInput["answers"],
): AttemptAnswer[] {
  const byId = new Map(submitted.map((a) => [a.questionId, a.response]));
  return questions.map((q) => {
    const response = byId.get(q.id) ?? null;
    return {
      questionId: q.id,
      type: q.type,
      response,
      graded: gradeOne(q, response),
    };
  });
}

export function gradeOne(q: Question, response: unknown): GradedAnswer | null {
  switch (q.type) {
    case "multiple_choice": {
      const correct = q.correctOptionIndex;
      if (correct === null || correct === undefined) return null;
      const ok = response === correct;
      return { earned: ok ? q.points : 0, possible: q.points, correct: ok, feedback: null };
    }
    case "true_false": {
      if (q.correctBool === null || q.correctBool === undefined) return null;
      const ok = response === q.correctBool;
      return { earned: ok ? q.points : 0, possible: q.points, correct: ok, feedback: null };
    }
    case "fill_in_the_blank":
    case "short_answer": {
      const accepted = (q.acceptableAnswers ?? []).map(normalizeAnswer);
      if (accepted.length === 0) return null;
      const given = Array.isArray(response) ? response : [String(response ?? "")];
      // Multi-blank: every blank must match its accepted variants ("a|b" per blank).
      const perBlank = accepted.map((entry) => entry.split("|").map((v) => v.trim()));
      const ok =
        given.length >= perBlank.length &&
        perBlank.every((variants, i) => variants.includes(normalizeAnswer(given[i] ?? "")));
      return { earned: ok ? q.points : 0, possible: q.points, correct: ok, feedback: null };
    }
    case "matching": {
      if (!q.pairs) return null;
      const given = Array.isArray(response) ? response : [];
      if (given.length !== q.pairs.length) {
        return { earned: 0, possible: q.points, correct: false, feedback: null };
      }
      const ok = q.pairs.every((p, i) => normalizeAnswer(given[i] ?? "") === normalizeAnswer(p.right));
      return { earned: ok ? q.points : 0, possible: q.points, correct: ok, feedback: null };
    }
    case "essay":
    default:
      // AI-graded later by the grading service.
      return null;
  }
}

/** Record a proctoring event + enforce the two-warning policy. */
export async function logProctorEvent(
  actor: SessionUser,
  attemptId: string,
  input: ProctorEventInput,
): Promise<{
  violations: number;
  warnings: number;
  action: "continue" | "warn" | "terminate";
}> {
  const attempt = await loadAttempt(attemptId);
  if (attempt.studentId !== actor.uid) {
    throw new AttemptsServiceError("Not your attempt.", 403);
  }
  if (attempt.status !== "in_progress") {
    return { violations: attempt.violationsCount, warnings: attempt.warningsIssued, action: "continue" };
  }

  const countsAsViolation = input.severity === "high" || input.severity === "critical";
  const violations = attempt.violationsCount + (countsAsViolation ? 1 : 0);

  // Policy: warn after the first violation, terminate after the second.
  let warnings = attempt.warningsIssued;
  let action: "continue" | "warn" | "terminate" = "continue";
  if (countsAsViolation) {
    if (violations <= PROCTORING.maxWarnings) {
      warnings += 1;
      action = violations === PROCTORING.maxWarnings ? "warn" : "warn";
    } else {
      action = "terminate";
    }
  }

  const event: WriteModel<ProctoringEventDoc> = {
    attemptId,
    examId: attempt.examId,
    studentId: actor.uid,
    schoolId: attempt.schoolId,
    type: input.type,
    severity: input.severity,
    details: input.details,
    aiVerdict: input.aiVerdict,
    occurredAt: FieldValue.serverTimestamp(),
  };

  await proctoringEventsCol().add(event);

  await attemptRef(attemptId).update({
    violationsCount: violations,
    warningsIssued: warnings,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (action === "terminate") {
    // Flag the attempt and notify the school admin via audit + flag status.
    await attemptRef(attemptId).update({
      status: "flagged",
      autoSubmitted: true,
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "attempt.flagged_cheating",
      targetType: "attempt",
      targetId: attemptId,
      meta: { type: input.type, severity: input.severity },
    });
  }

  return { violations, warnings, action };
}

/** Attach uploaded recording storage paths to an attempt. */
export async function attachRecordings(
  actor: SessionUser,
  attemptId: string,
  refs: { cameraPath: string | null; screenPath: string | null },
): Promise<void> {
  const attempt = await loadAttempt(attemptId);
  if (attempt.studentId !== actor.uid) {
    throw new AttemptsServiceError("Not your attempt.", 403);
  }
  await attemptRef(attemptId).update({
    recordings: {
      cameraPath: refs.cameraPath ?? attempt.recordings?.cameraPath ?? null,
      screenPath: refs.screenPath ?? attempt.recordings?.screenPath ?? null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Attempts visible to a student, newest first, with exam metadata joined. */
export async function listStudentAttempts(actor: SessionUser): Promise<
  { attempt: WithId<AttemptDoc>; exam: { id: string; title: string; subject: string; durationMinutes: number; questionCount: number } | null }[]
> {
  const snap = await attemptsCol()
    .where("studentId", "==", actor.uid)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  const attempts = snap.docs.map((d) => ({ id: d.id, ...d.data()! }));

  const examIds = [...new Set(attempts.map((a) => a.examId))];
  const examMetaById = new Map<
    string,
    { id: string; title: string; subject: string; durationMinutes: number; questionCount: number }
  >();
  await Promise.all(
    examIds.map(async (id) => {
      const snap = await examDoc(id).get();
      if (!snap.exists) return;
      const e = snap.data()!;
      examMetaById.set(id, {
        id,
        title: e.title,
        subject: e.params.subject,
        durationMinutes: e.params.durationMinutes,
        questionCount: e.questions.length,
      });
    }),
  );

  return attempts.map((attempt) => ({
    attempt,
    exam: examMetaById.get(attempt.examId) ?? null,
  }));
}

export async function getAttemptDetail(
  actor: SessionUser,
  attemptId: string,
): Promise<{ attempt: WithId<AttemptDoc>; exam: WithId<ExamDoc> | null }> {
  const attempt = await loadAttempt(attemptId);
  const allowed =
    attempt.studentId === actor.uid ||
    actor.role === "super_admin" ||
    (actor.role === "admin" && attempt.schoolId !== null && attempt.schoolId === actor.schoolId);
  if (!allowed) throw new AttemptsServiceError("Not allowed.", 403);
  const exam = await loadExam(attempt.examId).catch(() => null);
  return { attempt, exam };
}
