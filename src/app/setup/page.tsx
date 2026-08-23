import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/features/auth/auth-shell";
import { SetupForm } from "@/components/features/auth/setup-form";
import { platformFlagsDoc } from "@/server/firebase/collections";

export const metadata: Metadata = { title: "Platform setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Without Firebase credentials there is nothing to check — show the form
  // (the API route re-validates authoritatively) instead of hanging on a
  // Firestore call that can never succeed.
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  );
  let completed = true;
  if (firebaseConfigured) {
    try {
      // Bound the check — an unreachable Firestore must never hang the page.
      const snap = await Promise.race([
        platformFlagsDoc().get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      completed = snap ? snap.exists && (snap.data()?.setupCompleted ?? false) : false;
    } catch {
      // Firebase reachable-check failed — allow the form; the API re-checks.
      completed = false;
    }
  } else {
    completed = false;
  }
  if (completed) redirect("/login");

  return (
    <AuthShell
      title="Set up Bridge"
      subtitle="Create the first Super Admin account. This page disables itself afterwards."
    >
      <SetupForm />
    </AuthShell>
  );
}
