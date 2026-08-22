"use client";

import { useEffect } from "react";
import { onIdTokenChanged, signOut as fbSignOut } from "firebase/auth";

import { authClient } from "@/lib/firebase/client";

/**
 * Keeps the httpOnly session cookie in sync with the Firebase ID token.
 * Firebase refreshes tokens roughly hourly; each refresh re-posts the token
 * so the server cookie never goes stale while a tab is open.
 */
export function AuthSync() {
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(authClient(), async (user) => {
      if (user) {
        const idToken = await user.getIdToken();
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        }).catch(() => undefined);
      }
      // Sign-out is initiated client-side (signOut helper); nothing to do here.
    });
    return unsubscribe;
  }, []);

  return null;
}

/** Sign out everywhere: Firebase client + session cookie. */
export async function logout(): Promise<void> {
  await fbSignOut(authClient()).catch(() => undefined);
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
}
