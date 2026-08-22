import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlertIcon } from "lucide-react";

import { requireUser } from "@/server/auth/session";
import { LogoutButton } from "@/components/features/auth/logout-button";

export const metadata: Metadata = { title: "Account banned" };
export const dynamic = "force-dynamic";

export default async function BannedPage() {
  await requireUser();

  return (
    <div className="bg-mesh flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
        <ShieldAlertIcon className="size-7" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Account banned</h1>
      <p className="text-muted-foreground max-w-md text-pretty">
        Your account has been banned due to a serious exam-integrity violation.
        Contact your administrator if you believe this is a mistake.
      </p>
      <LogoutButton />
      <Link href="/" className="text-muted-foreground text-sm hover:underline">
        Back to home
      </Link>
    </div>
  );
}
