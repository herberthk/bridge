"use server";

import { revalidatePath } from "next/cache";

import {
  createSchoolSchema,
  createStandaloneAdminSchema,
} from "@/lib/schemas/users";
import { apiUser } from "@/server/auth/session";
import {
  createSchoolWithOwner,
  createStandaloneAdmin,
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

  const walletId = String(formData.get("walletId") ?? "");
  const tokens = Number(formData.get("tokens"));
  const description = String(formData.get("description") || "").trim() || undefined;
  if (!walletId || !Number.isFinite(tokens) || tokens <= 0) {
    return { ok: false, error: "Enter a valid token amount." };
  }

  try {
    await topupWallet(actor, { walletId, tokens, description });
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
