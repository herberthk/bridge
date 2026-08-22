import type { Metadata } from "next";
import Link from "next/link";
import { PauseCircleIcon } from "lucide-react";

import { requireUser } from "@/server/auth/session";
import { LogoutButton } from "@/components/features/auth/logout-button";

export const metadata: Metadata = { title: "Account suspended" };
export const dynamic = "force-dynamic";

export default async function SuspendedPage() {
  await requireUser();

  return (
    <div className="bg-mesh flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="bg-brand-soft flex size-14 items-center justify-center rounded-2xl text-2xl">
        <PauseCircleIcon className="size-7" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Account suspended</h1>
      <p className="text-muted-foreground max-w-md text-pretty">
        Your account is temporarily suspended by your administrator. You&apos;ll
        regain access once the suspension is lifted.
      </p>
      <LogoutButton />
      <Link href="/" className="text-muted-foreground text-sm hover:underline">
        Back to home
      </Link>
    </div>
  );
}
