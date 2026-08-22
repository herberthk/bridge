import { FieldValue } from "firebase-admin/firestore";

import { generateText, Output } from "ai";

import { textModel, modelIds } from "@/server/ai/provider";
import {
  chunkDocumentText,
  examGenerationInstructions,
  examGenerationPrompt,
} from "@/server/ai/prompts";
import {
  attemptDoc,
  attemptsCol,
  examDoc,
  examsCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { assertCanAfford, consumeTokens } from "@/server/services/billing";
import { loadDocumentExcerpts } from "@/server/services/documents";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptDoc,
  ExamDoc,
  ExamParams,
  WithId,
  WriteModel,
} from "@/types/firestore";
import type {
  AssignExamInput,
  ExamOutput,
  GenerateExamInput,
} from "@/lib/schemas/exam";
import { examOutputSchema } from "@/lib/schemas/exam";
import { estimateGenerationTokens } from "@/lib/pricing";
import type { Question } from "@/types/firestore";

export class ExamsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/** Generate an exam with Gemini, metered against the caller's wallet. */
export async function generateExam(
  actor: SessionUser,
  input: GenerateExamInput,
): Promise<{ exam: WithId<ExamDoc>; tokensUsed: number }> {
  const walletId = actor.schoolId ?? actor.uid;
  const estimate = estimateGenerationTokens(
    input.params.questionCount,
    input.documentIds.length > 0,
  );
  await assertCanAfford(walletId, estimate);

  const excerpts = input.documentIds.length
    ? await loadDocumentExcerpts(actor, input.documentIds)
    : [];

  let output: ExamOutput;
  let tokensUsed: number;
  try {
    const result = await generateText({
      model: textModel(),
      instructions: examGenerationInstructions(input.params),
      prompt: examGenerationPrompt(
        input.params,
        excerpts.map((d) => ({ name: d.name, text: chunkDocumentText(d.text) })),
      ),
      output: Output.object({ schema: examOutputSchema }),
      maxOutputTokens: Math.min(16_384, 800 + input.params.questionCount * 420),
      temperature: 0.7,
    });
    output = result.output;
    const usage = result.usage;
    tokensUsed =
      usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown AI error";
    throw new ExamsServiceError(`AI generation failed: ${message}`, 502);
  }

  if (output.questions.length !== input.params.questionCount) {
    // Tolerate near-misses from the model but reject wild deviations.
    const drift = Math.abs(output.questions.length - input.params.questionCount);
    if (drift > Math.max(2, input.params.questionCount * 0.2)) {
      throw new ExamsServiceError(
        `AI returned ${output.questions.length} questions (expected ${input.params.questionCount}). Try again.`,
        502,
      );
    }
  }

  const questions: Question[] = output.questions.map((q, i) => ({
    id: `q${i + 1}`,
    ...q,
  }));

  const now = FieldValue.serverTimestamp();
  const params: ExamParams = {
    ...input.params,
    subject: input.params.subject as ExamParams["subject"],
  };
  const doc: WriteModel<ExamDoc> = {
    title: output.title,
    params,
    questions,
    sourceType: excerpts.length ? "documents" : "params",
    sourceDocumentIds: input.documentIds,
    status: "draft",
    createdBy: actor.uid,
    schoolId: actor.schoolId,
    usage: {
      generationInputTokens: tokensUsed,
      generationOutputTokens: tokensUsed,
      gradingTokens: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
  const ref = await examsCol().add(doc);

  await consumeTokens({
    walletId,
    tokens: tokensUsed,
    category: "text_generation",
    description: `Generated “${output.title}”`,
    refType: "exam",
    refId: ref.id,
    actorId: actor.uid,
  }).catch(async (err) => {
    console.error("[exams] billing failed for exam", ref.id, err);
    // Keep the exam (already delivered) but surface the billing issue loudly.
    throw new ExamsServiceError(
      "Exam generated but billing failed — contact the platform admin.",
      500,
    );
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "exam.generated",
    targetType: "exam",
    targetId: ref.id,
    meta: { tokensUsed, model: modelIds.text(), subject: params.subject },
  });

  return {
    exam: { id: ref.id, ...(doc as ExamDoc), createdAt: null as unknown as ExamDoc["createdAt"] },
    tokensUsed,
  };
}

/** Assign an exam to students → creates pending attempts (optionally scheduled). */
export async function assignExam(
  actor: SessionUser,
  input: AssignExamInput,
): Promise<number> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new ExamsServiceError("Not allowed.", 403);
  }
  const examSnap = await examDoc(input.examId).get();
  if (!examSnap.exists) throw new ExamsServiceError("Exam not found.", 404);
  const exam = examSnap.data()!;
  if (actor.role === "admin" && exam.schoolId && exam.schoolId !== actor.schoolId) {
    throw new ExamsServiceError("This exam belongs to another school.", 403);
  }

  const now = FieldValue.serverTimestamp();
  const base: WriteModel<AttemptDoc> = {
    examId: input.examId,
    studentId: "",
    schoolId: exam.schoolId,
    status: "pending",
    scheduledFor: input.scheduledFor ? FieldValue.serverTimestamp() : null,
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

  let created = 0;
  for (const studentId of input.studentIds) {
    // Skip if an open/unfinished attempt already exists for this exam.
    const existing = await attemptsCol()
      .where("examId", "==", input.examId)
      .where("studentId", "==", studentId)
      .where("status", "in", ["pending", "in_progress", "submitted"])
      .limit(1)
      .get();
    if (!existing.empty) continue;

    await attemptsCol().add({ ...base, studentId });
    created += 1;
  }

  if (created > 0) {
    await examDoc(input.examId).update({
      status: exam.status === "draft" ? "scheduled" : exam.status,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "exam.assigned",
    targetType: "exam",
    targetId: input.examId,
    meta: { students: created, scheduledFor: input.scheduledFor },
  });

  return created;
}

export async function listExams(
  actor: SessionUser,
  limit = 50,
): Promise<WithId<ExamDoc>[]> {
  let query = examsCol().orderBy("createdAt", "desc").limit(limit);
  if (actor.role === "admin" && actor.schoolId) {
    query = examsCol()
      .where("schoolId", "==", actor.schoolId)
      .orderBy("createdAt", "desc")
      .limit(limit);
  } else if (actor.role === "admin") {
    query = examsCol()
      .where("createdBy", "==", actor.uid)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }
  const snap = await query.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
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
    (actor.role === "admin" &&
      attempt.schoolId !== null &&
      attempt.schoolId === actor.schoolId);
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return attempt;
}
