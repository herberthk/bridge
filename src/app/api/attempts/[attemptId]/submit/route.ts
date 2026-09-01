import { NextResponse, type NextRequest } from "next/server";

import { submitAttemptSchema } from "@/lib/schemas/attempt";
import { apiUser } from "@/server/auth/session";
import { submitAttempt, AttemptsServiceError } from "@/server/services/attempts";
import { gradeAttemptWithAi } from "@/server/services/grading";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = submitAttemptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid submission." },
      { status: 400 },
    );
  }

  try {
    const { attemptId } = await ctx.params;
    const result = await submitAttempt(actor, attemptId, parsed.data);

    // Fire-and-forget AI grading for essays — results appear when ready.
    if (result.needsAiGrading) {
      void gradeAttemptWithAi(attemptId).catch((err) =>
        console.error("[grading] async AI grading failed", err),
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Submission failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
