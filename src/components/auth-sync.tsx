"use client";

import { useEffect } from "react";
import { onIdTokenChanged, signOut as fbSignOut } from "firebase/auth";

import { authClient } from "@/lib/firebase/client";

/**
 * Keeps the httpOnly session cookie in sync with the Firebase ID token.
 * Firebase refreshes tokens roughly hourly; each refresh re-posts the token
 * (flagged as a renewal) so the server cookie never goes stale while a tab
 * is open — and renewals are not recorded as logins.
 */
export function AuthSync() {
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(authClient(), async (user) => {
      if (user) {
        const idToken = await user.getIdToken();
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, kind: "refresh" }),
        }).catch(() => undefined);
      }
      // Sign-out is initiated client-side (signOut helper); nothing to do here.
    });
    return unsubscribe;
  }, []);

  return null;
}

/** Clear client-side session artifacts (exam drafts, cached auth). */
export function clearClientSession(): void {
  try {
    sessionStorage.removeItem("bridge:onboarding-step");
    const draftKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("bridge:exam-draft:")) draftKeys.push(key);
    }
    draftKeys.forEach((key) => sessionStorage.removeItem(key));
  } catch {}
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("bridge:") || k.startsWith("firebase:"))) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/**
 * Force-refresh the Firebase ID token and re-mint the httpOnly session cookie.
 *
 * Custom claims only reach a session cookie when a *new* ID token is exchanged
 * — a force refresh picks them up immediately, where the normal hourly renewal
 * would leave the server seeing the old role (e.g. after onboarding promotes a
 * member to school admin). Returns false when the refresh could not complete.
 */
export async function refreshSession(): Promise<boolean> {
  const user = authClient().currentUser;
  if (!user) return false;
  try {
    const idToken = await user.getIdToken(true);
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, kind: "refresh" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sign out everywhere: Firebase client + session cookie and clear local session. Navigation is handled by the caller via useRouter().push('/login'). */
export async function logout(): Promise<void> {
  await fbSignOut(authClient()).catch(() => undefined);
  const response = await fetch("/api/auth/session", { method: "DELETE" });
  if (!response.ok) throw new Error("Could not clear the server session.");
  if (typeof window !== "undefined") clearClientSession();
}
