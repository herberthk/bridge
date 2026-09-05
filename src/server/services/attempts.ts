import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";

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
  AttemptScore,
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
import { hasResponse as hasAnswer } from "@/lib/exam/review-buckets";
import { PROCTORING } from "@/lib/constants";
import { notifyUsers, staffRecipientsForStudent } from "@/server/services/notifications";

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

/**
 * Assert the attempt belongs to the acting student — cheap ownership gate
 * used before expensive work (AI analysis, uploads).
 */
export async function assertAttemptOwner(
  actor: SessionUser,
  attemptId: string,
): Promise<WithId<AttemptDoc>> {
  const attempt = await loadAttempt(attemptId);
  if (attempt.studentId !== actor.uid) {
    throw new AttemptsServiceError("Not your attempt.", 403);
  }
  return attempt;
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
    if (exam.expiresAt && exam.expiresAt.toMillis() <= Date.now()) {
      throw new AttemptsServiceError(
        `This exam closed on ${exam.expiresAt.toDate().toLocaleString()}.`,
        403,
      );
    }
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

  // Backwards compat: exams created before the policy fields get secure defaults.
  // Recording is disabled by default (per requirements) even for old exams.
  const policy = {
    preventBacktrack: (exam.params as unknown as { preventBacktrack?: boolean }).preventBacktrack ?? true,
    allowReviewBeforeSubmit: (exam.params as unknown as { allowReviewBeforeSubmit?: boolean }).allowReviewBeforeSubmit ?? false,
    allowSkipping: (exam.params as unknown as { allowSkipping?: boolean }).allowSkipping ?? true,
    requireFullscreen: (exam.params as unknown as { requireFullscreen?: boolean }).requireFullscreen ?? true,
    enableCameraRecording: (exam.params as unknown as { enableCameraRecording?: boolean }).enableCameraRecording ?? false,
    enableScreenRecording: (exam.params as unknown as { enableScreenRecording?: boolean }).enableScreenRecording ?? false,
  };

  return {
    attemptId,
    examTitle: exam.title,
    subject: exam.params.subject,
    durationMinutes: exam.params.durationMinutes,
    deadlineMs,
    questions: exam.questions.map(toSafeQuestion),
    policy,
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
    visual: (q as Question).visual ?? null,
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
  if (attempt.status === "pending") {
    // Never started — submitting directly would bypass proctoring.
    throw new AttemptsServiceError("Start the exam before submitting.", 409);
  }

  const exam = await loadExam(attempt.examId);
  const now = Date.now();
  const startedMs = attempt.startedAt?.toMillis() ?? now;
  const deadlineMs = startedMs + exam.params.durationMinutes * 60_000;
  const late = now > deadlineMs + 2_000; // 2s network grace

  const answers = gradeAnswers(exam.questions, input.answers);
  const possibleTotal = exam.questions.reduce((n, q) => n + q.points, 0);
  const needsAiGrading = answers.some((a) => a.graded === null && hasAnswer(a.response));

  // Objective-only attempts are fully graded right here: leaving them
  // "submitted" strands them — the AI service is the sole writer of "graded"
  // and the submit route only invokes it when needsAiGrading is true, so such
  // attempts previously kept their score but showed "Grading…" forever (and
  // silently dropped out of leaderboards and retake eligibility, which all
  // filter on status).
  const finalStatus = needsAiGrading ? "submitted" : "graded";

  // Transactional write with an in_progress guard: a concurrent proctoring
  // termination (flag) must win over a late manual submit, never the reverse.
  const result = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef(attemptId));
    if (!snap.exists) throw new AttemptsServiceError("Attempt not found.", 404);
    const currentStatus = snap.data()!.status;
    if (currentStatus !== "in_progress") {
      return { committed: false, currentStatus };
    }
    const ts = FieldValue.serverTimestamp();
    tx.update(attemptRef(attemptId), {
      status: finalStatus,
      answers,
      submittedAt: ts,
      autoSubmitted: input.autoSubmitted || late,
      timeSpentSeconds: Math.min(
        input.timeSpentSeconds,
        Math.round((now - startedMs) / 1000),
      ),
      score:
        !needsAiGrading && possibleTotal > 0 ? summarizeScore(answers, exam.questions) : null,
      // Synchronous finalization carries its own timestamp so downstream
      // readers never have to infer "graded" from score presence.
      ...(needsAiGrading ? {} : { gradedAt: ts }),
      updatedAt: ts,
    });
    return { committed: true, currentStatus: finalStatus };
  });

  if (!result.committed) {
    return { status: result.currentStatus as AttemptDoc["status"], needsAiGrading: false };
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: input.autoSubmitted || late ? "attempt.auto_submitted" : "attempt.submitted",
    targetType: "attempt",
    targetId: attemptId,
    meta: { late, questions: answers.length },
  });

  // Notify the student's teacher(s) + school admin (best-effort).
  void (async () => {
    try {
      const staff = await staffRecipientsForStudent(actor.uid);
      if (!staff) return;
      const examSnap = await examDoc(attempt.examId).get().catch(() => null);
      const examTitle = examSnap?.exists ? examSnap.data()!.title : "an exam";
      const body = `${actor.displayName} submitted “${examTitle}"${
        input.autoSubmitted ? " (auto-submitted when time expired)" : ""
      }.`;
      const base = { type: "exam_submitted" as const, body, actorId: actor.uid };
      await Promise.all([
        notifyUsers(staff.adminIds, { ...base, title: `Exam submitted: ${examTitle}`, link: `/admin/exams/${attempt.examId}` }),
        notifyUsers(staff.teacherIds, { ...base, title: `Exam submitted: ${examTitle}`, link: `/teacher/exams/${attempt.examId}` }),
      ]);
    } catch (err) {
      console.error("[attempts] submit notification failed", err);
    }
  })();

  return { status: finalStatus, needsAiGrading };
}

/**
 * A response worth sending to the AI grader.
 *
 * Blank essays (`""`, whitespace-only, untouched per-slot arrays) finalize
 * instantly as skipped (0 marks, no feedback) instead of burning a model
 * call — the review UI already buckets unanswered responses that way.
 *
 * Single-sourced from the client-safe review module so submit bucketing and
 * review bucketing cannot drift apart.
 */
export { hasAnswer };

/**
 * Attempt totals from graded answers — the single implementation behind both
 * writers (synchronous submit and AI finalize), so the two paths cannot
 * drift apart. Skipped/ungraded answers contribute 0 earned but keep their
 * full weight in `possible`; rounding is half-up via Math.round.
 */
export function summarizeScore(
  answers: AttemptAnswer[],
  questions: Pick<Question, "points">[],
): AttemptScore {
  const earned = answers.reduce((n, a) => n + (a.graded?.earned ?? 0), 0);
  const possible = questions.reduce((n, q) => n + q.points, 0);
  return { earned, possible, percentage: possible > 0 ? Math.round((earned / possible) * 100) : 0 };
}

/** One AI grade as produced by the essay grading schema. */
export interface AiGrade {
  questionId: string;
  earned: number;
  possible: number;
  feedback: string;
}

/**
 * Merge AI grades into stored answers (pure — unit-tested).
 *
 * The model is instructed to grade against each question's marks, but its
 * echoed `possible` is not trustworthy: normalizing to the paper's points
 * keeps the per-question badge and the attempt percentage on the same
 * denominator. `earned` is clamped into range, and grades for unknown
 * question ids are ignored. `correct` uniformly means full marks — partial
 * credit lands on the failed side, matching the deterministic grader above.
 */
export function applyAiGrades(
  answers: AttemptAnswer[],
  aiGrades: AiGrade[],
  questions: Pick<Question, "id" | "points">[],
): AttemptAnswer[] {
  const gradesByQuestion = new Map(aiGrades.map((g) => [g.questionId, g]));
  const pointsByQuestion = new Map(questions.map((q) => [q.id, q.points]));
  return answers.map((a) => {
    const ai = gradesByQuestion.get(a.questionId);
    if (!ai) return a;
    const possible = Math.max(0, pointsByQuestion.get(a.questionId) ?? ai.possible);
    const earned = Math.min(Math.max(0, ai.earned), possible);
    return {
      ...a,
      graded: {
        earned,
        possible,
        correct: possible > 0 ? earned >= possible : null,
        feedback: ai.feedback,
      },
    };
  });
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
  const attempt = await assertAttemptOwner(actor, attemptId);
  if (attempt.status !== "in_progress") {
    return { violations: attempt.violationsCount, warnings: attempt.warningsIssued, action: "continue" };
  }

  // Atomically increment counters — concurrent events (tab_switch bursts)
  // must not lose violation counts.
  const outcome = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef(attemptId));
    if (!snap.exists) throw new AttemptsServiceError("Attempt not found.", 404);
    const current = snap.data()!;
    if (current.status !== "in_progress") {
      return {
        violations: current.violationsCount,
        warnings: current.warningsIssued,
        action: "continue" as const,
      };
    }

    const countsAsViolation = input.severity === "high" || input.severity === "critical";
    const violations = current.violationsCount + (countsAsViolation ? 1 : 0);

    // Policy: warn after the first violation, terminate after the second.
    let warnings = current.warningsIssued;
    let action: "continue" | "warn" | "terminate" = "continue";
    if (countsAsViolation) {
      if (violations <= PROCTORING.maxWarnings) {
        warnings += 1;
        action = "warn";
      } else {
        action = "terminate";
      }
    }

    const now = FieldValue.serverTimestamp();
    if (action === "terminate") {
      // Flag atomically with the counter update — a concurrent submit racing
      // this transaction can no longer overwrite the flagged state.
      tx.update(attemptRef(attemptId), {
        violationsCount: violations,
        warningsIssued: warnings,
        status: "flagged",
        autoSubmitted: true,
        submittedAt: now,
        updatedAt: now,
      });
    } else {
      tx.update(attemptRef(attemptId), {
        violationsCount: violations,
        warningsIssued: warnings,
        updatedAt: now,
      });
    }
    return { violations, warnings, action };
  });

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

  if (outcome.action === "terminate") {
    // Status was already flipped inside the transaction — just notify.
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "attempt.flagged_cheating",
      targetType: "attempt",
      targetId: attemptId,
      meta: { type: input.type, severity: input.severity },
    });
  }

  return outcome;
}

/** Attach uploaded recording storage paths to an attempt. */
export async function attachRecordings(
  actor: SessionUser,
  attemptId: string,
  refs: { cameraPath: string | null; screenPath: string | null },
): Promise<void> {
  const attempt = await assertAttemptOwner(actor, attemptId);
  await attemptRef(attemptId).update({
    recordings: {
      cameraPath: refs.cameraPath ?? attempt.recordings?.cameraPath ?? null,
      screenPath: refs.screenPath ?? attempt.recordings?.screenPath ?? null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Fields needed by list views (dashboard/exams/results) — excludes answers. */
type AttemptListFields = Pick<
  AttemptDoc,
  | "examId"
  | "status"
  | "score"
  | "submittedAt"
  | "gradedAt"
  | "scheduledFor"
  | "autoSubmitted"
  | "createdAt"
  | "retakeOf"
>;
export type StudentAttemptListItem = WithId<AttemptListFields>;

/** Attempts visible to a student, newest first, with exam metadata joined. */
export interface StudentAttemptWithExam {
  attempt: StudentAttemptListItem;
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    questionCount: number;
  } | null;
}
export async function listStudentAttempts(actor: SessionUser): Promise<StudentAttemptWithExam[]> {
  // List views only need metadata — project away the heavy answers/feedback
  // arrays so listing 100 attempts doesn't deserialize megabytes.
  const snap = await attemptsCol()
    .where("studentId", "==", actor.uid)
    .orderBy("createdAt", "desc")
    .limit(100)
    .select(
      "examId",
      "status",
      "score",
      "submittedAt",
      "gradedAt",
      "scheduledFor",
      "autoSubmitted",
      "createdAt",
      "retakeOf",
    )
    .get();
  const attempts = snap.docs.map(
    (d) => ({ id: d.id, ...d.data()! }) as StudentAttemptListItem,
  );

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
