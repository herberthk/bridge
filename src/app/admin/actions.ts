"use server";

import { revalidatePath } from "next/cache";

import { createStudentSchema, setUserStatusSchema } from "@/lib/schemas/users";
import {
  createClassesSchema,
  createTeacherInviteSchema,
  assignTeacherClassesSchema,
  authorizeRetakeSchema,
  updateSchoolProfileSchema,
} from "@/lib/schemas/school";
import { saveQuestionsSchema, setApprovalSchema } from "@/lib/schemas/exam-review";
import { apiUser } from "@/server/auth/session";
import {
  createStudent,
  setUserStatus,
  UsersServiceError,
} from "@/server/services/users";
import {
  assignExam,
  getAssignedStudentIdsForExam,
  ExamsServiceError,
} from "@/server/services/exams";
import { saveQuestions, setApproval } from "@/server/services/exam-review";
import {
  authorizeRetake,
  decideRetake,
  RetakesServiceError,
} from "@/server/services/retakes";
import {
  createClasses,
  assignTeacherClasses,
  ClassesServiceError,
} from "@/server/services/classes";
import {
  createTeacherInvite,
  revokeInvite,
  InvitesServiceError,
} from "@/server/services/invites";
import {
  requestSchoolVerification,
  updateSchoolProfile,
  SchoolsServiceError,
} from "@/server/services/schools";
import type { ExamReview, Question } from "@/types/firestore";
import type { z } from "zod";

export type ActionState =
  | { ok: true; createdCount?: number; assignedIds?: string[]; inviteUrl?: string }
  | { ok: false; error: string };

/** Revalidate the same pages for both staff areas after a shared mutation. */
function revalidateStaffPaths(...extra: string[]) {
  for (const p of ["/admin", "/teacher", ...extra]) {
    revalidatePath(p);
  }
}

export async function createStudentAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const rawSubLevel = formData.get("secondarySubLevel");
  const classId = String(formData.get("classId") ?? "").trim();
  const level = (formData.get("level") as "primary" | "secondary" | null) ?? undefined;
  const parsed = createStudentSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    classId: classId || undefined,
    // When joining a class, level/class come from the class doc server-side.
    level: classId ? undefined : level,
    secondarySubLevel:
      !classId && level === "secondary"
        ? ((typeof rawSubLevel === "string" && rawSubLevel) || null)
        : null,
    classLevel: classId ? undefined : Number(formData.get("classLevel")),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createStudent(actor, parsed.data);
    revalidateStaffPaths("/admin/students", "/teacher/students");
    if (classId) {
      revalidatePath(`/admin/classes/${classId}`);
      revalidatePath(`/teacher/classes/${classId}`);
    }
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
  const actor = await apiUser("admin", "teacher", "super_admin");
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
    revalidatePath(`/admin/exams/${examId}`);
    revalidatePath("/admin");
    revalidatePath("/teacher/exams");
    revalidatePath(`/teacher/exams/${examId}`);
    revalidatePath("/teacher");
    return created > 0
      ? { ok: true, createdCount: created, assignedIds: studentIds }
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

export async function getAssignedStudentIdsAction(
  examId: string,
): Promise<{ ok: true; studentIds: string[] } | { ok: false; error: string }> {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };
  try {
    const studentIds = await getAssignedStudentIdsForExam(actor, examId);
    return { ok: true, studentIds };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ExamsServiceError
          ? err.message
          : "Failed to load assigned students.",
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
  const actor = await apiUser("admin", "teacher", "super_admin");
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
    revalidatePath(`/teacher/exams/${parsed.data.examId}/review`);
    revalidatePath(`/teacher/exams/${parsed.data.examId}`);
    revalidatePath("/teacher/exams");
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
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = setApprovalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    const review = await setApproval(actor, parsed.data);
    revalidatePath(`/admin/exams/${parsed.data.examId}/review`);
    revalidatePath("/admin/exams");
    revalidatePath(`/teacher/exams/${parsed.data.examId}/review`);
    revalidatePath("/teacher/exams");
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
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const requestId = String(formData.get("requestId") ?? "");
  const approve = formData.get("approve") === "true";
  if (!requestId) return { ok: false, error: "Missing request." };

  try {
    await decideRetake(actor, requestId, approve);
    revalidatePath("/admin/requests");
    revalidatePath("/teacher/requests");
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

/* ── Classes ────────────────────────────────────────────────────── */

/** Staff create missing standard classes for their school. */
export async function createClassesAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "teacher");
  if (!actor) return { ok: false, error: "Not authorized." };

  const classLevels = formData
    .getAll("classLevels")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const parsed = createClassesSchema.safeParse({ classLevels });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const created = await createClasses(actor, parsed.data);
    revalidateStaffPaths("/admin/classes", "/teacher/classes");
    return { ok: true, createdCount: created.length };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ClassesServiceError
          ? err.message
          : "Could not create the classes. Try again.",
    };
  }
}

/* ── Retakes: direct staff grant ────────────────────────────────── */

export async function authorizeRetakeAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = authorizeRetakeSchema.safeParse({
    attemptId: formData.get("attemptId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await authorizeRetake(actor, parsed.data.attemptId);
    revalidateStaffPaths("/admin/requests", "/teacher/requests");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof RetakesServiceError
          ? err.message
          : "Could not authorize the retake. Try again.",
    };
  }
}

/* ── Teachers: invites + class assignment ───────────────────────── */

export async function inviteTeacherAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const classIds = formData.getAll("classIds").map(String).filter(Boolean);
  const parsed = createTeacherInviteSchema.safeParse({
    email: formData.get("email"),
    classIds,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    const { inviteUrl } = await createTeacherInvite(actor, parsed.data);
    revalidatePath("/admin/teachers");
    return { ok: true, inviteUrl };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof InvitesServiceError
          ? err.message
          : "Could not create the invite. Try again.",
    };
  }
}

export async function revokeInviteAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const inviteId = String(formData.get("inviteId") ?? "");
  if (!inviteId) return { ok: false, error: "Missing invite." };

  try {
    await revokeInvite(actor, inviteId);
    revalidatePath("/admin/teachers");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof InvitesServiceError
          ? err.message
          : "Could not revoke the invite. Try again.",
    };
  }
}

/** Admin sets the full list of classes a teacher manages. */
export async function assignTeacherClassesAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const classIds = formData.getAll("classIds").map(String).filter(Boolean);
  const parsed = assignTeacherClassesSchema.safeParse({
    teacherId: formData.get("teacherId"),
    classIds,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await assignTeacherClasses(actor, parsed.data);
    revalidateStaffPaths("/admin/teachers", "/admin/classes", "/teacher/classes");
    return { ok: true, assignedIds: classIds };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ClassesServiceError
          ? err.message
          : "Could not update the assignment. Try again.",
    };
  }
}

/* ── School profile + verification ──────────────────────────────── */

export async function updateSchoolProfileAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = updateSchoolProfileSchema.safeParse({
    name: formData.get("name"),
    motto: formData.get("motto") || undefined,
    address: formData.get("address") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    registrationNumber: formData.get("registrationNumber") || undefined,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await updateSchoolProfile(actor, parsed.data);
    revalidatePath("/admin/school");
    revalidatePath("/admin");
    revalidatePath("/teacher");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof SchoolsServiceError
          ? err.message
          : "Could not update the school. Try again.",
    };
  }
}

/** Admin submits the school for the super admin's blue-tick review. */
export async function requestVerificationAction(
  _prev: ActionState | null,
  _formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  try {
    await requestSchoolVerification(actor);
    revalidatePath("/admin/school");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof SchoolsServiceError
          ? err.message
          : "Could not request verification. Try again.",
    };
  }
}
