import { FieldValue } from "firebase-admin/firestore";
import { generateText, Output } from "ai";
import { z } from "zod";
import React from "react";

import { modelIds } from "@/server/ai/provider";
import { attemptDoc, examDoc, userDoc } from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { consumeTokens } from "@/server/services/billing";
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
 * AI-grade the subjective answers of a submitted attempt and finalize the
 * attempt (`graded`) with per-question + overall feedback.
 */
export async function gradeAttemptWithAi(attemptId: string): Promise<void> {
  const attemptSnap = await attemptDoc(attemptId).get();
  if (!attemptSnap.exists) return;
  const attempt = attemptSnap.data()!;
  if (attempt.status !== "submitted") return;

  const examSnap = await examDoc(attempt.examId).get();
  if (!examSnap.exists) return;
  const exam = examSnap.data()!;

  const pending = attempt.answers.filter(
    (a) => a.graded === null && a.response !== null,
  );
  if (pending.length === 0) {
    await finalize(attemptId, attempt, exam, [], null);
    return;
  }

  const questionsById = new Map(exam.questions.map((q) => [q.id, q]));

  let output: z.infer<typeof essayGradeSchema>;
  let tokensUsed = 0;
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
      temperature: 0.3,
      maxOutputTokens: Math.min(12_000, Math.max(2_000, pending.length * 500 + 800)),
      providerOptions: {
        google: googleOptions,
        googleVertex: googleOptions,
      },
    });
    output = result.output;
    const usage = result.usage;
    tokensUsed = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  } catch (err) {
    console.error("[grading] AI failed", err);
    throw err;
  }

  await finalize(attemptId, attempt, exam, output.grades, {
    overall: output.overallFeedback,
    strengths: output.strengths,
    improvements: output.improvements,
    generatedByModel: modelIds.text(),
  });

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

  await examDoc(attempt.examId).update({
    usage: {
      ...exam.usage,
      gradingTokens: (exam.usage.gradingTokens ?? 0) + tokensUsed,
    },
    updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => undefined);

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

async function finalize(
  attemptId: string,
  attempt: AttemptDoc,
  exam: ExamDoc,
  aiGrades: { questionId: string; earned: number; possible: number; feedback: string }[],
  feedback: Omit<AttemptFeedback, "perQuestion"> | null,
): Promise<void> {
  const gradesByQuestion = new Map(aiGrades.map((g) => [g.questionId, g]));

  const answers: AttemptAnswer[] = attempt.answers.map((a) => {
    const ai = gradesByQuestion.get(a.questionId);
    if (ai) {
      return {
        ...a,
        graded: {
          earned: Math.min(ai.earned, ai.possible || a.graded?.possible || 0),
          possible: ai.possible || a.graded?.possible || 0,
          correct: ai.possible > 0 ? ai.earned >= ai.possible : null,
          feedback: repairProse(ai.feedback),
        },
      };
    }
    return a;
  });

  const earned = answers.reduce((n, a) => n + (a.graded?.earned ?? 0), 0);
  const possible = exam.questions.reduce((n, q) => n + q.points, 0);
  const percentage = possible > 0 ? Math.round((earned / possible) * 100) : 0;

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

  await attemptDoc(attemptId).update({
    status: "graded",
    answers,
    score: { earned, possible, percentage },
    feedback: fullFeedback,
    gradedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
