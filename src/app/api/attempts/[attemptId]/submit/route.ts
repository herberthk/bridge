import { after, NextResponse, type NextRequest } from "next/server";

import { submitAttemptSchema } from "@/lib/schemas/attempt";
import { apiUser } from "@/server/auth/session";
import { submitAttempt, AttemptsServiceError } from "@/server/services/attempts";
import { gradeAttemptWithAi } from "@/server/services/grading";

/**
 * Covers the synchronous submit plus the `after()` grading window below: one
 * 50s grading call fits, the retry may not. If the host caps lower (Vercel
 * Hobby: 60s), a killed grading run is safe: the attempt stays "submitted"
 * and the sweeper retries via /api/internal/grade-attempt.
 */
export const maxDuration = 60;

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
    // `after()` (not bare `void`) keeps the work alive past the response on
    // serverless hosts, where a detached promise can be frozen mid-run and
    // strand the attempt in "submitted" forever.
    if (result.needsAiGrading) {
      after(() =>
        gradeAttemptWithAi(attemptId).catch((err) =>
          console.error("[grading] async AI grading failed", err),
        ),
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
