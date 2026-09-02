import type { Metadata } from "next";
import Link from "next/link";

import { requireRole } from "@/server/auth/session";
import { LogoutButton } from "@/components/features/auth/logout-button";
import { ThemeToggle } from "@/components/app-shell/app-shell";
import { SchoolWizard } from "@/components/features/school/school-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your school — Bridge",
};

/**
 * Member onboarding: the signed-up user creates their school here and is
 * promoted to its admin. Not part of any dashboard shell — a focused,
 * premium first-run experience.
 */
export default async function OnboardingPage() {
  const user = await requireRole("member");

  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />

      <header className="relative z-10 flex w-full max-w-2xl items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5"
        >
          <span className="bg-brand flex size-9 items-center justify-center rounded-xl text-primary-foreground">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden
            >
              <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
              <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
              <path d="M6 4v2M12 4v2M18 4v2" />
            </svg>
          </span>
          <span className="text-lg font-semibold tracking-tight">Bridge</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden text-xs sm:block">
            Signed in as {user.email}
          </span>
          <ThemeToggle />
          <LogoutButton variant="ghost" />
        </div>
      </header>

      <div className="relative z-10 flex w-full justify-center">
        <SchoolWizard />
      </div>
    </div>
  );
}
