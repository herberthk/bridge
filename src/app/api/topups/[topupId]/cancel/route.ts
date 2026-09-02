import { NextResponse } from "next/server";

import { apiUser } from "@/server/auth/session";
import { cancelTopup, TopupsServiceError } from "@/server/services/topups";

/** Buyer abandons a pending checkout. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ topupId: string }> },
) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { topupId } = await params;
  try {
    await cancelTopup(actor, topupId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TopupsServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/topups/cancel] failed", err);
    return NextResponse.json({ error: "Could not cancel the checkout." }, { status: 500 });
  }
}
