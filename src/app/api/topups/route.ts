import { NextResponse, type NextRequest } from "next/server";

import { createTopupSchema } from "@/lib/schemas/school";
import { apiUser } from "@/server/auth/session";
import { createTopup, TopupsServiceError } from "@/server/services/topups";
import { BillingError } from "@/server/services/billing";

/** Start a pay-as-you-go wallet top-up checkout (school staff). */
export async function POST(request: NextRequest) {
  const actor = await apiUser("admin", "teacher");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = createTopupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const { topup, redirectUrl } = await createTopup(actor, parsed.data);
    return NextResponse.json({
      ok: true,
      topupId: topup.id,
      tokens: topup.tokens,
      amountUgx: topup.amountUgx,
      redirectUrl,
    });
  } catch (err) {
    if (err instanceof TopupsServiceError || err instanceof BillingError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/topups] checkout failed", err);
    return NextResponse.json({ error: "Could not start the checkout. Try again." }, { status: 500 });
  }
}
