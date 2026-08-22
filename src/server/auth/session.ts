import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { adminAuth } from "@/server/firebase/admin";
import { userDoc } from "@/server/firebase/collections";
import type { LoginMeta, UserDoc, WithId } from "@/types/firestore";
import type { Role } from "@/lib/constants";
import { parseUserAgent } from "@/lib/user-agent";

export const SESSION_COOKIE = "bridge-session";
/** ID tokens live 1h; AuthSync refreshes the cookie, so the cookie itself
 * may live longer and simply fail verification once stale. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 5;

/** The authenticated user as seen by server components/actions. */
export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string;
  role: Role;
  schoolId: string | null;
  status: UserDoc["status"];
}

export function roleHome(role: Role): string {
  switch (role) {
    case "super_admin":
      return "/super";
    case "admin":
      return "/admin";
    case "student":
      return "/student";
  }
}

/** Extract request context (IP + user agent) for audit/analytics. */
export async function requestContext(): Promise<LoginMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : (h.get("x-real-ip") ?? null);
  const userAgent = h.get("user-agent");
  const parsed = parseUserAgent(userAgent);
  return { ip, userAgent, browser: parsed.browser, device: parsed.device };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

async function loadUser(uid: string): Promise<WithId<UserDoc> | null> {
  const snap = await userDoc(uid).get();
  return snap.exists ? ({ id: snap.id, ...snap.data()! } as WithId<UserDoc>) : null;
}

/**
 * Verify the session cookie and load the user. Memoized per request via
 * React `cache`. Returns null when unauthenticated (incl. stale/banned).
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const decoded = await adminAuth().verifyIdToken(token, true);
    const doc = await loadUser(decoded.uid);
    if (!doc) return null;
    const role = (decoded.role as Role | undefined) ?? doc.role;
    return {
      uid: decoded.uid,
      email: decoded.email ?? doc.email,
      displayName: doc.displayName,
      role,
      schoolId: doc.schoolId,
      status: doc.status,
    };
  } catch {
    return null;
  }
});

/** Guard for server components — redirects to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Guard that also enforces role + active status. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(roleHome(user.role));
  if (user.status === "banned") redirect("/banned");
  if (user.status === "suspended") redirect("/suspended");
  return user;
}

/** Guard for API route handlers — returns null instead of redirecting. */
export async function apiUser(...roles: Role[]): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (roles.length && !roles.includes(user.role)) return null;
  if (user.status !== "active") return null;
  return user;
}
