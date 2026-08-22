import { NextResponse, type NextRequest } from "next/server";

import { apiUser } from "@/server/auth/session";
import { startAttempt, AttemptsServiceError } from "@/server/services/attempts";

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  try {
    const started = await startAttempt(actor, (await ctx.params).attemptId);
    return NextResponse.json({ ok: true, ...started });
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Could not start the exam.";
    return NextResponse.json({ error: message }, { status });
  }
}
