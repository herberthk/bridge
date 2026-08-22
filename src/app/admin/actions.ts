"use server";

import { revalidatePath } from "next/cache";

import { createStudentSchema, setUserStatusSchema } from "@/lib/schemas/users";
import { apiUser } from "@/server/auth/session";
import {
  createStudent,
  setUserStatus,
  UsersServiceError,
} from "@/server/services/users";

export type ActionState = { ok: true } | { ok: false; error: string };

export async function createStudentAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = createStudentSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    level: formData.get("level") ?? undefined,
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
