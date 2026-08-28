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

/** Sign out everywhere: Firebase client + session cookie and clear local session. Navigation is handled by the caller via useRouter().push('/login'). */
export async function logout(): Promise<void> {
  await fbSignOut(authClient()).catch(() => undefined);
  const response = await fetch("/api/auth/session", { method: "DELETE" });
  if (!response.ok) throw new Error("Could not clear the server session.");
  if (typeof window !== "undefined") clearClientSession();
}
