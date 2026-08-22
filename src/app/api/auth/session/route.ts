import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";

import { z } from "zod";
import { adminAuth } from "@/server/firebase/admin";
import { userDoc } from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { recordLoginMetrics } from "@/server/services/analytics";
import {
  SESSION_COOKIE,
  requestContext,
  roleHome,
  sessionCookieOptions,
} from "@/server/auth/session";
import type { WithId, UserDoc } from "@/types/firestore";

const bodySchema = z.object({ idToken: z.string().min(20) });

/** Exchange a fresh Firebase ID token for an httpOnly session cookie. */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(parsed.data.idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid or expired session token." }, { status: 401 });
  }

  const snap = await userDoc(decoded.uid).get();
  if (!snap.exists) {
    return NextResponse.json(
      { error: "Account has no Bridge profile. Contact your administrator." },
      { status: 403 },
    );
  }
  const user = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;

  if (user.status === "banned") {
    return NextResponse.json(
      {
        error: user.banReason
          ? `This account is banned: ${user.banReason}`
          : "This account is banned. Contact your administrator.",
      },
      { status: 403 },
    );
  }
  if (user.status === "suspended") {
    const until = user.suspendedUntil?.toDate().toLocaleDateString() ?? "a later time";
    return NextResponse.json(
      { error: `This account is suspended until ${until}.` },
      { status: 403 },
    );
  }

  const context = await requestContext();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, parsed.data.idToken, sessionCookieOptions());

  await userDoc(user.id).update({
    lastLoginAt: FieldValue.serverTimestamp(),
    lastLoginMeta: context,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth.login",
    context,
  });
  void recordLoginMetrics(context.browser, context.device);

  return NextResponse.json({ ok: true, role: user.role, home: roleHome(user.role) });
}

/** Sign out — clear the session cookie. */
export async function DELETE() {
  const context = await requestContext();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      await writeAudit({
        actorId: decoded.uid,
        actorRole: null,
        action: "auth.logout",
        context,
      });
    } catch {
      // Stale token — cookie clearing is still valid.
    }
  }
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
