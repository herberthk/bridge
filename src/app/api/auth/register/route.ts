import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { FieldValue } from "firebase-admin/firestore";

import { z } from "zod";
import { adminAuth } from "@/server/firebase/admin";
import { userDoc } from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { requestContext } from "@/server/auth/session";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/server/auth/session";
import type { WriteModel, UserDoc } from "@/types/firestore";

const bodySchema = z.object({
  idToken: z.string().min(20),
  displayName: z.string().trim().min(2).max(80),
});

/**
 * Public sign-up: exchange a freshly-created Firebase ID token for a session
 * and provision the Bridge profile with role "member". The member then
 * onboards (create a school → becomes its admin).
 */
export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(parsed.data.idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  const existing = await userDoc(decoded.uid).get();
  if (existing.exists) {
    // Already provisioned (e.g. double-submit) — treat as a plain login.
    const doc = existing.data()!;
    return NextResponse.json({ ok: true, role: doc.role, home: doc.role === "member" ? "/onboarding" : "/dashboard" });
  }

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<UserDoc> = {
    email: decoded.email ?? "",
    displayName: parsed.data.displayName,
    photoURL: null,
    role: "member",
    schoolId: null,
    status: "active",
    classLevel: null,
    level: null,
    secondarySubLevel: null,
    classId: null,
    assignedClassIds: null,
    createdBy: null,
    banReason: null,
    suspendedUntil: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    lastLoginMeta: null,
  };

  try {
    await adminAuth().setCustomUserClaims(decoded.uid, { role: "member", schoolId: null });
    await userDoc(decoded.uid).set(doc);
  } catch (err) {
    console.error("[api/auth/register] provisioning failed", err);
    return NextResponse.json(
      { error: "Could not create your profile. Try again." },
      { status: 500 },
    );
  }

  let sessionCookieValue: string;
  try {
    sessionCookieValue = await adminAuth().createSessionCookie(parsed.data.idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch {
    return NextResponse.json({ error: "Could not establish a session." }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionCookieValue, sessionCookieOptions());

  const context = await requestContext();
  await writeAudit({
    actorId: decoded.uid,
    actorRole: "member",
    action: "auth.signup",
    context,
  });

  return NextResponse.json({ ok: true, role: "member", home: "/onboarding" });
}
