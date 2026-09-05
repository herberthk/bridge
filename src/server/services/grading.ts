import { randomUUID } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { generateText, Output } from "ai";
import { z } from "zod";
import React from "react";

import { modelIds } from "@/server/ai/provider";
import { attemptDoc, auditLogsCol, examDoc, userDoc } from "@/server/firebase/collections";
import { adminDb } from "@/server/firebase/admin";
import { writeAudit } from "@/server/services/audit";
import { consumeTokens } from "@/server/services/billing";
import { hasAnswer, summarizeScore, applyAiGrades, assertCompleteGrades } from "@/server/services/attempts";
import { repairProse, thinkingOptions } from "@/server/services/exams";
import { appUrl, sendTemplateEmail } from "@/server/services/email";
import { ExamResultsEmail } from "@/emails/templates";
import type {
  AttemptAnswer,
  AttemptDoc,
  AttemptFeedback,
  ExamDoc,
} from "@/types/firestore";
import { vertex } from "@/lib/vertext";
import { notifyUsers } from "@/server/services/notifications";

const essayGradeSchema = z.object({
  grades: z.array(
    z.object({
      questionId: z.string(),
      earned: z.number().int().min(0),
      possible: z.number().int().min(0),
      feedback: z.string(),
    }),
  ),
  overallFeedback: z.string(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
});

/**
 * Consecutive failed runs before an attempt dead-letters for a human instead
 * of retrying forever. Each failed run burns real Vertex tokens that are
 * deliberately NOT billed (schools never pay for model failures), so an
 * uncapped retry loop is an unbounded platform cost.
 */
export const MAX_GRADING_ATTEMPTS = 5;

/**
 * AI-grade the subjective answers of a submitted attempt and finalize the
 * attempt (`graded`) with per-question + overall feedback.
 *
 * Safe to call redundantly (submit route, internal sweeper, backfills):
 * generation is claimed inside a transaction, so concurrent or repeated calls
 * make at most one model request at a time. Each claim increments
 * `gradingAttempts`; past the cap the attempt stays `submitted` with an
 * `attempt.grading_exhausted` audit for staff to pick up.
 */
export async function gradeAttemptWithAi(attemptId: string): Promise<void> {
  const attemptSnap = await attemptDoc(attemptId).get();
  if (!attemptSnap.exists) return;
  const attempt = attemptSnap.data()!;
  if (attempt.status !== "submitted") return;
  const examSnap = await examDoc(attempt.examId).get();
  if (!examSnap.exists) return;
  const exam = examSnap.data()!;

  const initiallyPending = attempt.answers.filter(
    (a) => a.graded === null && hasAnswer(a.response),
  );
  if (initiallyPending.length === 0) {
    // Nothing for the model to do (objective-only or blank essays) — claim
    // and finalize synchronously. This is also the self-heal path for docs
    // submitted before synchronous finalization existed.
    await finalize(attemptId, attempt, exam, [], null);
    return;
  }

  const claim = await claimGradingRun(attemptId);
  if (!claim) return;
  const pending = claim.attempt.answers.filter(
    (a) => a.graded === null && hasAnswer(a.response),
  );

  if (pending.length === 0) {
    await finalize(attemptId, claim.attempt, exam, [], null, claim.token);
    return;
  }

  const questionsById = new Map(exam.questions.map((q) => [q.id, q]));

  let output: z.infer<typeof essayGradeSchema>;
  let tokensUsed = 0;
  try {
    ({ output, tokensUsed } = await generateGrades(exam, pending, questionsById));
  } catch (err) {
    console.error("[grading] AI failed", err);
    // Leave the attempt "submitted" for the sweeper retry, but leave a trace
    // so stuck attempts are distinguishable from merely slow ones.
    await recordGradingFailure(attemptId, claim.token, pending.length, err);
    throw err;
  }

  // The model must return each pending question exactly once — no missing,
  // duplicate, or unknown IDs. Rejecting here (before finalize) leaves the
  // attempt "submitted" so the sweeper retries, instead of finalizing a
  // partial grade set where missing answers silently score 0.
  try {
    assertCompleteGrades(
      pending.map((a) => a.questionId),
      output.grades.map((g) => g.questionId),
    );
  } catch (err) {
    console.error("[grading] invalid grade set", err);
    await recordGradingFailure(attemptId, claim.token, pending.length, err);
    throw err;
  }

  const claimed = await finalize(
    attemptId,
    claim.attempt,
    exam,
    output.grades,
    {
      overall: output.overallFeedback,
      strengths: output.strengths,
      improvements: output.improvements,
      generatedByModel: modelIds.text(),
    },
    claim.token,
  );
  // Lost the finalize race (concurrent retry won) — it already billed.
  if (!claimed) return;

  // Bill the exam owner's wallet for grading tokens.
  const walletId = exam.schoolId ?? exam.createdBy;
  await consumeTokens({
    walletId,
    tokens: tokensUsed,
    category: "grading",
    description: `Graded “${exam.title}”`,
    refType: "attempt",
    refId: attemptId,
    actorId: null,
  }).catch((err) => console.error("[grading] billing failed", err));

  // Atomic increment — the old read-modify-write lost tokens when generation
  // and grading billing landed concurrently.
  await examDoc(attempt.examId)
    .update({
      "usage.gradingTokens": FieldValue.increment(tokensUsed),
      updatedAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);

  await writeAudit({
    actorId: null,
    actorRole: null,
    action: "attempt.ai_graded",
    targetType: "attempt",
    targetId: attemptId,
    meta: { tokensUsed, graded: output.grades.length },
  });

  // Notify the student their results are ready (best-effort).
  void notifyStudentOfResults(attemptId).catch(() => undefined);
}

/**
 * Wall clock for one grading call — sized so the call plus its one retry
 * (2 × 50s + backoff) fits inside the internal route's `maxDuration = 120`.
 * A larger budget just burns a doomed second attempt before the host kills it.
 */
const GRADING_CALL_TIMEOUT_MS = 50_000;
const GRADING_LEASE_MS = GRADING_CALL_TIMEOUT_MS * 2 + 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function claimGradingRun(
  attemptId: string,
): Promise<{ attempt: AttemptDoc; token: string } | null> {
  const token = randomUUID();
  return adminDb().runTransaction(async (tx) => {
    const ref = attemptDoc(attemptId);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const current = snap.data()!;
    const now = Date.now();
    const leaseActive = (current.gradingLease?.expiresAt.toMillis() ?? 0) > now;
    if (
      current.status !== "submitted" ||
      leaseActive ||
      (current.gradingAttempts ?? 0) >= MAX_GRADING_ATTEMPTS
    ) {
      return null;
    }

    tx.update(ref, {
      gradingAttempts: (current.gradingAttempts ?? 0) + 1,
      gradingLease: {
        token,
        expiresAt: Timestamp.fromMillis(now + GRADING_LEASE_MS),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { attempt: current, token };
  });
}

/**
 * One grading call plus a single retry for transient Vertex blips (quota,
 * 5xx, network). The loser's work is harmless: finalization is claimed
 * transactionally downstream, so a duplicate success bills exactly once.
 */
async function generateGrades(
  exam: ExamDoc,
  pending: AttemptAnswer[],
  questionsById: Map<string, ExamDoc["questions"][number]>,
): Promise<{ output: z.infer<typeof essayGradeSchema>; tokensUsed: number }> {
  let lastErr: unknown = null;
  for (let attemptNo = 1; attemptNo <= 2; attemptNo += 1) {
    try {
      const modelId = modelIds.text();
      const googleOptions = { thinkingConfig: thinkingOptions(modelId), structuredOutputs: false };
      const result = await generateText({
        model: vertex(modelId),
        instructions: [
          "You are a fair, encouraging Ugandan-curriculum examiner grading exam answers.",
          "Grade each answer against its marks (points). Be consistent and objective.",
          "For each answer give concise specific feedback (1–3 sentences) the student can learn from.",
          "Then write an overallFeedback paragraph (Markdown), 3 strengths, and 3 improvements",
          "targeted at this student's performance. Use LaTeX for any math.",
        ].join("\n"),
        prompt: JSON.stringify({
          exam: { title: exam.title, subject: exam.params.subject, level: exam.params.level, class: exam.params.classLevel },
          answers: pending.map((a) => {
            const q = questionsById.get(a.questionId);
            return {
              questionId: a.questionId,
              question: q?.prompt,
              type: a.type,
              points: q?.points,
              acceptableGuidance: q?.acceptableAnswers,
              studentAnswer: a.response,
            };
          }),
        }),
        output: Output.object({ schema: essayGradeSchema }),
        maxOutputTokens: Math.min(12_000, Math.max(2_000, pending.length * 500 + 800)),
        abortSignal: AbortSignal.timeout(GRADING_CALL_TIMEOUT_MS),
        providerOptions: {
          google: googleOptions,
          googleVertex: googleOptions,
        },
      });
      const usage = result.usage;
      return {
        output: result.output,
        tokensUsed: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      };
    } catch (err) {
      lastErr = err;
      console.error(`[grading] AI attempt ${attemptNo}/2 failed`, err);
      if (attemptNo < 2) await sleep(2000);
    }
  }
  throw lastErr;
}

/**
 * Count a failed run toward the retry cap and leave an audit trace.
 * Best-effort: a counter write must never mask the original error.
 * When the cap is reached the audit action flips to `grading_exhausted`
 * so staff can find dead-lettered attempts.
 */
async function recordGradingFailure(
  attemptId: string,
  leaseToken: string,
  pendingCount: number,
  err: unknown,
): Promise<void> {
  await adminDb()
    .runTransaction(async (tx) => {
      const ref = attemptDoc(attemptId);
      const snap = await tx.get(ref);
      if (
        !snap.exists ||
        snap.data()!.status !== "submitted" ||
        snap.data()!.gradingLease?.token !== leaseToken
      ) {
        return;
      }

      const failures = snap.data()!.gradingAttempts ?? 1;
      const exhausted = failures >= MAX_GRADING_ATTEMPTS;
      const timestamp = FieldValue.serverTimestamp();
      tx.update(ref, {
        gradingLease: null,
        updatedAt: timestamp,
      });
      tx.create(auditLogsCol().doc(), {
        actorId: null,
        actorRole: null,
        action: exhausted ? "attempt.grading_exhausted" : "attempt.grading_failed",
        targetType: "attempt",
        targetId: attemptId,
        meta: {
          pending: pendingCount,
          failures,
          error: err instanceof Error ? err.message : String(err),
        },
        ip: null,
        userAgent: null,
        createdAt: timestamp,
      });
    })
    .catch(() => undefined);
}

async function notifyStudentOfResults(attemptId: string): Promise<void> {
  const attemptSnap = await attemptDoc(attemptId).get();
  const userSnap = attemptSnap.exists
    ? await userDoc(attemptSnap.data()!.studentId).get().catch(() => null)
    : null;
  const attempt = attemptSnap.exists ? attemptSnap.data()! : null;
  if (!attempt?.score) return;
  const user = userSnap?.exists ? userSnap.data()! : null;
  if (!user?.email) return;

  const examSnap = await examDoc(attempt.examId).get().catch(() => null);
  const title = examSnap?.exists ? examSnap.data()!.title : "Your exam";

  // In-app notification rides along with the email (best-effort).
  try {
    await notifyUsers([attempt.studentId], {
      type: "results_ready",
      title: `Results ready: ${title}`,
      body: `You scored ${attempt.score.percentage}% on “${title}”. Open your results for the full breakdown.`,
      link: `/student/results/${attemptId}`,
      actorId: null,
    });
  } catch (err) {
    console.error("[grading] results notification failed", err);
  }

  await sendTemplateEmail({
    to: user.email,
    subject: `Your results for ${title} are ready`,
    template: React.createElement(ExamResultsEmail, {
      displayName: user.displayName,
      examTitle: title,
      score: attempt.score,
      resultUrl: appUrl(`/student/results/${attemptId}`),
    }),
  });
}

/**
 * Claim the finalize exactly once and write the graded result.
 *
 * Returns true when this call won the claim (caller proceeds to bill);
 * false when the attempt is gone or another worker already finalized it —
 * in which case the caller must stop before billing, or tokens get charged
 * twice for one grading.
 */
async function finalize(
  attemptId: string,
  attempt: AttemptDoc,
  exam: ExamDoc,
  aiGrades: { questionId: string; earned: number; possible: number; feedback: string }[],
  feedback: Omit<AttemptFeedback, "perQuestion"> | null,
  leaseToken: string | null = null,
): Promise<boolean> {
  // Shared pure helpers: per-question merge (AI `possible` normalized to the
  // paper) plus prose repair for AI-written feedback only.
  const answers: AttemptAnswer[] = applyAiGrades(attempt.answers, aiGrades, exam.questions).map(
    (a) =>
      a.graded?.feedback
        ? { ...a, graded: { ...a.graded, feedback: repairProse(a.graded.feedback) } }
        : a,
  );

  const score = summarizeScore(answers, exam.questions);

  const fullFeedback: AttemptFeedback | null = feedback
    ? {
        overall: repairProse(feedback.overall) ?? "",
        strengths: feedback.strengths
          .map(repairProse)
          .filter((value): value is string => value !== null)
          .slice(0, 3),
        improvements: feedback.improvements
          .map(repairProse)
          .filter((value): value is string => value !== null)
          .slice(0, 3),
        generatedByModel: feedback.generatedByModel,
        perQuestion: Object.fromEntries(
          answers
            .filter((a) => a.graded?.feedback)
            .map((a) => [a.questionId, a.graded!.feedback!]),
        ),
      }
    : null;

  // The claim: only a still-"submitted" attempt may be finalized. A retry
  // racing the original (or a sweeper racing a late success) loses here and
  // returns false, so the loser stops before billing.
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(attemptDoc(attemptId));
    if (
      !snap.exists ||
      snap.data()!.status !== "submitted" ||
      (leaseToken !== null && snap.data()!.gradingLease?.token !== leaseToken)
    ) {
      return false;
    }
    tx.update(attemptDoc(attemptId), {
      status: "graded",
      answers,
      score,
      feedback: fullFeedback,
      gradingLease: null,
      gradedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}
