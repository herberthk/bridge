import { NextResponse, type NextRequest } from "next/server";

import { acceptInviteSchema } from "@/lib/schemas/school";
import { acceptTeacherInvite, InvitesServiceError } from "@/server/services/invites";

/**
 * Public invite acceptance — no session yet; the single-use invite token is
 * the authority. Creates the teacher's Auth account + profile, then the
 * client redirects to /login.
 */
export async function POST(request: NextRequest) {
  const parsed = acceptInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const { email } = await acceptTeacherInvite(parsed.data);
    return NextResponse.json({ ok: true, email, loginUrl: "/login" });
  } catch (err) {
    if (err instanceof InvitesServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/invites/accept] failed", err);
    const code = (err as { code?: string })?.code ?? "";
    if (code === "auth/email-already-exists" || code === "auth/uid-already-exists") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    if (code.startsWith("auth/")) {
      return NextResponse.json({ error: "Could not create the account." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not accept the invite. Try again." }, { status: 500 });
  }
}
