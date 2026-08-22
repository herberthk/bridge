"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { apiUser } from "@/server/auth/session";
import { requestRetake, RetakesServiceError } from "@/server/services/retakes";

const retakeSchema = z.object({
  attemptId: z.string().min(1),
  reason: z.string().trim().min(10, "Tell your teacher why (10+ characters)").max(500),
});

export async function requestRetakeAction(
  _prev: { ok: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await apiUser("student");
  if (!actor) return { ok: false, error: "Not authorized." };

  const parsed = retakeSchema.safeParse({
    attemptId: formData.get("attemptId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await requestRetake(actor, parsed.data.attemptId, parsed.data.reason);
    revalidatePath(`/student/results/${parsed.data.attemptId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof RetakesServiceError
          ? err.message
          : "Could not send the request. Try again.",
    };
  }
}
