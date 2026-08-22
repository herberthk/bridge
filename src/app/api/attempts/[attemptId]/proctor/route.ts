import { NextResponse, type NextRequest } from "next/server";

import { proctorEventSchema } from "@/lib/schemas/attempt";
import { apiUser } from "@/server/auth/session";
import { logProctorEvent, AttemptsServiceError } from "@/server/services/attempts";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = proctorEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  try {
    const outcome = await logProctorEvent(actor, (await ctx.params).attemptId, parsed.data);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Could not record the event.";
    return NextResponse.json({ error: message }, { status });
  }
}
