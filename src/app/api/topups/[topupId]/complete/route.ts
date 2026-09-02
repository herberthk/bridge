import { NextResponse } from "next/server";

import { apiUser } from "@/server/auth/session";
import { completeTopup, TopupsServiceError } from "@/server/services/topups";
import { BillingError } from "@/server/services/billing";

/**
 * Confirm payment (simulated for the mock provider; a real gateway's webhook
 * would call into the same `completeTopup` service function).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ topupId: string }> },
) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { topupId } = await params;
  try {
    const result = await completeTopup(actor, topupId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof TopupsServiceError || err instanceof BillingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/topups/complete] failed", err);
    return NextResponse.json({ error: "Payment confirmation failed." }, { status: 500 });
  }
}
