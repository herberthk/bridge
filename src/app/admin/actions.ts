"use server";

import { revalidatePath } from "next/cache";

import { createStudentSchema, setUserStatusSchema } from "@/lib/schemas/users";
import { saveQuestionsSchema, setApprovalSchema } from "@/lib/schemas/exam-review";
import { apiUser } from "@/server/auth/session";
import {
  createStudent,
  setUserStatus,
  UsersServiceError,
} from "@/server/services/users";
import { assignExam, ExamsServiceError } from "@/server/services/exams";
import { saveQuestions, setApproval } from "@/server/services/exam-review";
import { decideRetake, RetakesServiceError } from "@/server/services/retakes";
import type { ExamReview, Question } from "@/types/firestore";
import type { z } from "zod";

export type ActionState = { ok: true } | { ok: false; error: string };

export async function createStudentAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const rawSubLevel = formData.get("secondarySubLevel");
  const level = (formData.get("level") as "primary" | "secondary" | null) ?? "secondary";
  const parsed = createStudentSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    level,
    secondarySubLevel:
      level === "secondary" ? ((typeof rawSubLevel === "string" && rawSubLevel) || null) : null,
    classLevel: Number(formData.get("classLevel")),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createStudent(actor, parsed.data);
    revalidatePath("/admin/students");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof UsersServiceError
          ? err.message
          : "Could not create the student. Try again.",
    };
  }
}

export async function setUserStatusAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = setUserStatusSchema.safeParse({
    userId: formData.get("userId"),
    status: formData.get("status"),
    reason: formData.get("reason") || undefined,
    suspendedUntil: formData.get("suspendedUntil") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await setUserStatus(actor, parsed.data);
    revalidatePath("/admin/students");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof UsersServiceError
          ? err.message
          : "Could not update the student. Try again.",
    };
  }
}

export async function assignExamAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const examId = String(formData.get("examId") ?? "");
  const studentIds = formData.getAll("studentIds").map(String).filter(Boolean);
  const scheduledRaw = String(formData.get("scheduledFor") ?? "").trim();
  const scheduledFor = scheduledRaw ? new Date(scheduledRaw).toISOString() : null;
  // Set by the "assign anyway" confirmation on the review screen. Compared against
  // the literal so that a missing, empty or unexpected value reads as false — the
  // gate this releases has to fail closed.
  const acknowledgeUnreviewed = formData.get("acknowledgeUnreviewed") === "true";

  if (!examId || studentIds.length === 0) {
    return { ok: false, error: "Select at least one student." };
  }
  if (scheduledRaw && Number.isNaN(Date.parse(scheduledRaw))) {
    return { ok: false, error: "Invalid schedule date." };
  }

  try {
    const created = await assignExam(actor, {
      examId,
      studentIds,
      scheduledFor,
      acknowledgeUnreviewed,
    });
    revalidatePath("/admin/exams");
    revalidatePath(`/admin/exams/${examId}/review`);
    revalidatePath("/admin");
    return created > 0
      ? { ok: true }
      : { ok: false, error: "Those students already have this exam assigned." };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ExamsServiceError
          ? err.message
          : "Assignment failed. Try again.",
    };
  }
}

/* ── Exam review ─────────────────────────────────────────────── */

/**
 * What the review screen gets back from a write.
 *
 * The updated questions and review state travel with the result so the client can
 * reconcile its optimistic state against what was actually stored, rather than
 * re-fetching the exam after every approval. On this screen a reviewer clicks
 * through twenty questions in a minute, and a round trip per click is the
 * difference between a tool and a form.
 */
export type ReviewWriteState =
  | { ok: true; questions: Question[]; review: ExamReview; changedCount: number }
  | { ok: false; error: string };

/**
 * Persist hand edits and accepted AI proposals.
 *
 * Typed for the caller's convenience but validated as untrusted input regardless:
 * a Server Action is a public POST endpoint, and its argument is whatever the
 * network sent, not whatever TypeScript said it would be.
 */
export async function saveQuestionsAction(
  input: z.input<typeof saveQuestionsSchema>,
): Promise<ReviewWriteState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = saveQuestionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  }

  try {
    const result = await saveQuestions(actor, parsed.data);
    revalidatePath(`/admin/exams/${parsed.data.examId}/review`);
    revalidatePath(`/admin/exams/${parsed.data.examId}`);
    revalidatePath("/admin/exams");
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ExamsServiceError ? err.message : "Could not save. Try again.",
    };
  }
}

/** Approve or re-open questions without changing their content. */
export async function setApprovalAction(
  input: z.input<typeof setApprovalSchema>,
): Promise<ReviewWriteState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = setApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const review = await setApproval(actor, parsed.data);
    revalidatePath(`/admin/exams/${parsed.data.examId}/review`);
    revalidatePath("/admin/exams");
    // Approval changes no content, so the client's questions are still current.
    // Returned empty rather than re-read: the caller uses `review` and ignores this.
    return { ok: true, questions: [], review, changedCount: 0 };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ExamsServiceError
          ? err.message
          : "Could not update the review. Try again.",
    };
  }
}

export async function decideRetakeAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const requestId = String(formData.get("requestId") ?? "");
  const approve = formData.get("approve") === "true";
  if (!requestId) return { ok: false, error: "Missing request." };

  try {
    await decideRetake(actor, requestId, approve);
    revalidatePath("/admin/requests");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof RetakesServiceError
          ? err.message
          : "Could not decide the request. Try again.",
    };
  }
}
