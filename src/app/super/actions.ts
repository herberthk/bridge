"use server";

import { revalidatePath } from "next/cache";

import {
  createSchoolSchema,
  createStandaloneAdminSchema,
  topupWalletSchema,
} from "@/lib/schemas/users";
import { setSchoolVerificationSchema } from "@/lib/schemas/school";
import { apiUser } from "@/server/auth/session";
import {
  createSchoolWithOwner,
  createStandaloneAdmin,
  setSchoolVerification,
  SchoolsServiceError,
} from "@/server/services/schools";
import { topupWallet, BillingError } from "@/server/services/billing";
import type { ActionState } from "@/app/admin/actions";

export async function createSchoolAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = createSchoolSchema.safeParse({
    schoolName: formData.get("schoolName"),
    level: formData.get("level"),
    ownerName: formData.get("ownerName"),
    ownerEmail: formData.get("ownerEmail"),
    ownerPassword: formData.get("ownerPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createSchoolWithOwner(actor, parsed.data);
    revalidatePath("/super/schools");
    revalidatePath("/super/wallets");
    revalidatePath("/super");
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

/** Grant or revoke a school's verification blue tick. */
export async function setSchoolVerificationAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = setSchoolVerificationSchema.safeParse({
    schoolId: formData.get("schoolId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await setSchoolVerification(actor, parsed.data.schoolId, parsed.data.status === "verified");
    revalidatePath("/super/schools");
    revalidatePath("/super");
    revalidatePath("/admin");
    revalidatePath("/teacher");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof SchoolsServiceError
          ? err.message
          : "Could not update verification. Try again.",
    };
  }
}

export async function createStandaloneAdminAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = createStandaloneAdminSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await createStandaloneAdmin(actor, parsed.data);
    revalidatePath("/super/schools");
    revalidatePath("/super/wallets");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof SchoolsServiceError
          ? err.message
          : "Could not create the admin. Try again.",
    };
  }
}

export async function topupWalletAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const actor = await apiUser("super_admin");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = topupWalletSchema.safeParse({
    walletId: formData.get("walletId"),
    tokens: formData.get("tokens"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await topupWallet(actor, parsed.data);
    revalidatePath("/super/wallets");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof BillingError
          ? err.message
          : "Top-up failed. Try again.",
    };
  }
}
