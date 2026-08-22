import { NextResponse, type NextRequest } from "next/server";

import { recordingRefsSchema } from "@/lib/schemas/attempt";
import { apiUser } from "@/server/auth/session";
import { attachRecordings, AttemptsServiceError } from "@/server/services/attempts";

/** Attach proctoring recording storage paths after upload. */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = recordingRefsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid recording refs." }, { status: 400 });
  }

  try {
    await attachRecordings(actor, (await ctx.params).attemptId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Could not attach recordings.";
    return NextResponse.json({ error: message }, { status });
  }
}
