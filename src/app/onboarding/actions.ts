"use server";

import { revalidatePath } from "next/cache";

import { createSelfSchoolSchema } from "@/lib/schemas/school";
import { apiUser } from "@/server/auth/session";
import {
  createSchoolForSelf,
  SchoolsServiceError,
} from "@/server/services/schools";
import type { ActionState } from "@/app/admin/actions";

/**
 * A member (signed-up user) creates their own school and becomes its admin.
 * On success the session's role claims have changed, so the client refreshes
 * and lands on the admin dashboard.
 */
export async function createMySchoolAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("member");
  if (!actor) return { ok: false, error: "Not authorized." };

  const classLevelsRaw = formData.getAll("classLevels").map((v) => Number(v));
  const parsed = createSelfSchoolSchema.safeParse({
    name: formData.get("name"),
    level: formData.get("level"),
    motto: formData.get("motto") || undefined,
    address: formData.get("address") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    registrationNumber: formData.get("registrationNumber") || undefined,
    description: formData.get("description") || undefined,
    classLevels: classLevelsRaw.length ? classLevelsRaw : undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createSchoolForSelf(actor, parsed.data);
    revalidatePath("/admin");
    revalidatePath("/admin/classes");
    revalidatePath("/admin/school");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof SchoolsServiceError
          ? err.message
          : "Could not create the school. Try again.",
    };
  }
}
