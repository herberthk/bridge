import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { timingSafeEqual } from "node:crypto";

import { setupSchema } from "@/lib/schemas/auth";
import { adminAuth } from "@/server/firebase/admin";
import { platformFlagsDoc, userDoc } from "@/server/firebase/collections";
import { requestContext } from "@/server/auth/session";
import { writeAudit } from "@/server/services/audit";

function keysMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * One-time platform bootstrap: creates the first Super Admin.
 * Guarded by SETUP_ADMIN_KEY; disables itself after success.
 */
export async function POST(request: NextRequest) {
  const flags = await platformFlagsDoc().get();
  if (flags.exists && flags.data()?.setupCompleted) {
    return NextResponse.json(
      { error: "Setup already completed. Sign in instead." },
      { status: 409 },
    );
  }

  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const setupKey = process.env.SETUP_ADMIN_KEY;
  if (!setupKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: SETUP_ADMIN_KEY is not set." },
      { status: 500 },
    );
  }
  if (!keysMatch(parsed.data.setupKey, setupKey)) {
    return NextResponse.json({ error: "Invalid setup key." }, { status: 403 });
  }

  const existing = await adminAuth().getUserByEmail(parsed.data.email).catch(() => null);
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const created = await adminAuth().createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    displayName: parsed.data.displayName,
    emailVerified: true,
  });
  await adminAuth().setCustomUserClaims(created.uid, {
    role: "super_admin",
    schoolId: null,
  });

  const now = FieldValue.serverTimestamp();
  await userDoc(created.uid).set({
    email: parsed.data.email,
    displayName: parsed.data.displayName,
    photoURL: null,
    role: "super_admin",
    schoolId: null,
    status: "active",
    classLevel: null,
    level: null,
    secondarySubLevel: null,
    createdBy: null,
    banReason: null,
    suspendedUntil: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginMeta: null,
  });
  await platformFlagsDoc().set({
    setupCompleted: true,
    setupCompletedAt: now,
  });

  const context = await requestContext();
  await writeAudit({
    actorId: created.uid,
    actorRole: "super_admin",
    action: "platform.setup_completed",
    targetType: "user",
    targetId: created.uid,
    context,
  });

  return NextResponse.json({ ok: true });
}
