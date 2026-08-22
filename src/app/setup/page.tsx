import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/features/auth/auth-shell";
import { SetupForm } from "@/components/features/auth/setup-form";
import { platformFlagsDoc } from "@/server/firebase/collections";

export const metadata: Metadata = { title: "Platform setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let completed = true;
  try {
    const flags = await platformFlagsDoc().get();
    completed = flags.exists && (flags.data()?.setupCompleted ?? false);
  } catch {
    // Firebase not configured yet — allow the form; the API route re-checks.
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
