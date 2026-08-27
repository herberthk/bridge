import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

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
  usersCol,
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
  // Reserve maximum budget for all retries and chunked fallback
  const maxAttempts = 3;
  const maxChunks = Math.ceil(input.params.questionCount / 5);
  const maxRetries = maxAttempts + maxChunks * 2;
  const reservedBudget = estimate * maxRetries;
  await assertCanAfford(walletId, reservedBudget);

  const excerpts = input.documentIds.length
    ? await loadDocumentExcerpts(actor, input.documentIds)
    : [];

  let output: ExamOutput | null = null;
  let tokensUsed = 0;
  let lastFailure: ExamsServiceError | null = null;

  // Helper: single Gemini call for exactly `count` questions, with
  // thinking budget capped so reasoning doesn't eat the output window.
  async function genSingle(
    params: GenerateExamInput["params"],
    docExcerpts: typeof excerpts,
    attemptNum: number,
  ): Promise<{ out: ExamOutput; tokens: number }> {
    const result = await generateText({
      model: textModel(),
      instructions: examGenerationInstructions(params),
      prompt: examGenerationPrompt(
        params,
        docExcerpts.map((d) => ({ name: d.name, text: chunkDocumentText(d.text) })),
      ),
      output: Output.object({ schema: examOutputSchema }),
      maxOutputTokens: Math.min(64_000, 9_000 + params.questionCount * 3_000),
      temperature: 0.55,
      // providerOptions: {
      //   google: {
      //     thinkingConfig: { thinkingBudget: 3000, includeThoughts: false },
      //   },
      // } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
    const usage = result.usage;
    const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    console.log(`[exams] gen attempt ${attemptNum}: ${result.output.questions.length}/${params.questionCount} q, ${tokens} tokens`);
    return { out: result.output, tokens };
  }

  // Phase 1: try full generation up to 3 times (transient truncation usually
  // succeeds on retry — don't immediately chunk).
  for (let attempt = 1; attempt <= maxAttempts && !output; attempt += 1) {
    try {
      const { out: candidate, tokens } = await genSingle(input.params, excerpts, attempt);
      tokensUsed += tokens;
      const count = candidate.questions.length;
      const drift = Math.abs(count - input.params.questionCount);
      if (count !== input.params.questionCount && drift > Math.max(2, input.params.questionCount * 0.2)) {
        // For severe truncation (e.g. 1 vs 20) immediately fall through to chunked
        // after recording failure — don't waste remaining full retries on same shape.
        const severe = count < Math.ceil(input.params.questionCount * 0.5);
        throw new ExamsServiceError(
          `AI returned ${count} questions (expected ${input.params.questionCount}).${severe ? " Severe truncation — will retry chunked." : ""}`,
          502,
        );
      }
      output = candidate;
    } catch (err) {
      console.error(`[exams] generation attempt ${attempt}/${maxAttempts} failed`, err);
      lastFailure =
        err instanceof ExamsServiceError
          ? err
          : new ExamsServiceError(
              `AI generation failed: ${err instanceof Error ? err.message : "Unknown AI error"}`,
              502,
            );
      // If severe truncation, break early to chunked fallback.
      if (lastFailure.message.includes("Severe truncation")) break;
    }
  }

  // Phase 2: chunked fallback — split 20 into 7+7+6 etc. This avoids the
  // single huge JSON array that triggers reasoning truncation. Each chunk is
  // cheap and reliably returns its exact count.
  if (!output) {
    const total = input.params.questionCount;
    const chunkSize = total > 10 ? 7 : 5;
    console.warn(`[exams] falling back to chunked generation (${total} → chunks of ${chunkSize})`);
    const chunks: Question[] = [];
    let chunkTitle: string | null = null;
    let chunkTokens = 0;
    let chunkIndex = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      const need = Math.min(chunkSize, total - offset);
      chunkIndex += 1;
      // Keep all params identical except questionCount for this slice.
      // For variety, suffix the topic so Gemini doesn't repeat identical questions.
      const chunkParams: GenerateExamInput["params"] = {
        ...input.params,
        questionCount: need,
        topic:
          chunkIndex === 1
            ? input.params.topic
            : `${input.params.topic} — part ${chunkIndex} (avoid repeating earlier questions)`,
      };
      let attempts = 0;
      let chunkOut: ExamOutput | null = null;
      while (attempts < 2 && !chunkOut) {
        attempts += 1;
        try {
          const { out, tokens } = await genSingle(chunkParams, excerpts, 100 + chunkIndex * 10 + attempts);
          chunkTokens += tokens;
          if (out.questions.length !== need) {
            throw new ExamsServiceError(
              `Chunk ${chunkIndex} returned ${out.questions.length}/${need} questions.`,
              502,
            );
          }
          chunkOut = out;
        } catch (err) {
          console.error(`[exams] chunk ${chunkIndex} attempt ${attempts} failed`, err);
          lastFailure =
            err instanceof ExamsServiceError
              ? err
              : new ExamsServiceError(
                  `Chunk ${chunkIndex} failed: ${err instanceof Error ? err.message : "Unknown"}`,
                  502,
                );
        }
      }
      if (!chunkOut) {
        throw lastFailure ?? new ExamsServiceError(`Failed to generate chunk ${chunkIndex} for ${need} questions. Try fewer questions or a shorter topic.`, 502);
      }
      if (!chunkTitle) chunkTitle = chunkOut.title;
      chunks.push(
        ...chunkOut.questions.map((q, i) => ({
          id: `q${offset + i + 1}`,
          ...q,
        })),
      );
    }
    tokensUsed += chunkTokens;
    output = {
      title: chunkTitle ?? `Exam: ${input.params.topic}`,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      questions: chunks.map(({ id, ...rest }) => rest as unknown as ExamOutput["questions"][number]),
    };
    console.log(`[exams] chunked generation succeeded: ${output.questions.length}/${total} q, +${chunkTokens} tokens`);
  }

  if (!output) {
    throw lastFailure ?? new ExamsServiceError("AI returned an empty exam. Try again.", 502);
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

  // Enforce that every referenced student actually belongs to this admin
  // (same school / standalone household). Prevents assigning exams to
  // arbitrary student ids across the platform.
  // Firestore "in" queries accept max 10 values (was 30 in older SDKs).
  const CHUNK = 10;
  const allowedIds = new Set<string>();
  for (let i = 0; i < input.studentIds.length; i += CHUNK) {
    const chunk = input.studentIds.slice(i, i + CHUNK);
    let query = usersCol().where("role", "==", "student");
    if (actor.role === "admin" && actor.schoolId) {
      query = query.where("schoolId", "==", actor.schoolId);
    } else if (actor.role === "admin") {
      query = query.where("createdBy", "==", actor.uid);
    }
    const snap = await query.where(FieldPath.documentId(), "in", chunk).get();
    snap.docs.forEach((d) => allowedIds.add(d.id));
  }
  const rejected = input.studentIds.filter((id) => !allowedIds.has(id));
  if (rejected.length > 0) {
    throw new ExamsServiceError(
      `${rejected.length} selected student(s) are not in your school.`,
      403,
    );
  }

  const now = FieldValue.serverTimestamp();
  let scheduledAt: Timestamp | null = null;
  if (input.scheduledFor) {
    const parsedMs = Date.parse(input.scheduledFor);
    if (isNaN(parsedMs)) {
      throw new ExamsServiceError("Invalid scheduledFor date.", 400);
    }
    scheduledAt = Timestamp.fromMillis(parsedMs);
  }
  const base: WriteModel<AttemptDoc> = {
    examId: input.examId,
    studentId: "",
    schoolId: exam.schoolId,
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

  // Skip students who already have an open/unfinished attempt for this exam.
  // One query per chunk instead of one per student (N+1 → N/30).
  const openStatuses = ["pending", "in_progress", "submitted"] as const;
  const hasOpenAttempt = new Set<string>();
  for (let i = 0; i < input.studentIds.length; i += CHUNK) {
    const chunk = input.studentIds.slice(i, i + CHUNK);
    const existing = await attemptsCol()
      .where("examId", "==", input.examId)
      .where("studentId", "in", chunk)
      .where("status", "in", [...openStatuses])
      .get();
    existing.docs.forEach((d) => hasOpenAttempt.add(d.data().studentId as string));
  }

  let created = 0;
  for (const studentId of input.studentIds) {
    if (hasOpenAttempt.has(studentId)) continue;

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
