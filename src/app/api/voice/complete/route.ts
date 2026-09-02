import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { apiUser } from "@/server/auth/session";
import { consumeTokens, assertCanAfford } from "@/server/services/billing";
import { writeAudit } from "@/server/services/audit";

const bodySchema = z.object({
  /** Session wall-clock seconds. */
  seconds: z.number().int().min(0).max(4 * 3600),
});

/** Bill a completed voice session at $0.08 / minute (school wallet). */
export async function POST(request: NextRequest) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid session length." }, { status: 400 });
  }

  const walletId = actor.schoolId ?? actor.uid;
  const minutes = parsed.data.seconds / 60;

  try {
    await assertCanAfford(walletId, 0); // verifies the wallet exists
    await consumeTokens({
      walletId,
      tokens: 0, // voice is billed by time, not tokens
      voiceMinutes: minutes,
      category: "voice",
      description: `Voice exam builder — ${minutes.toFixed(1)} min`,
      refType: "voice_session",
      refId: null,
      actorId: actor.uid,
    });
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "voice.session_billed",
      meta: { minutes: Math.round(minutes * 10) / 10 },
    });
    return NextResponse.json({ ok: true, minutes: Math.round(minutes * 100) / 100 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Billing failed." },
      { status: 402 },
    );
  }
}
