import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getTopup, TopupsServiceError } from "@/server/services/topups";
import { getSchoolById } from "@/server/services/schools";
import { CheckoutClient } from "@/components/features/school/checkout-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout — Bridge",
  robots: { index: false },
};

/**
 * Simulated hosted checkout (the mock payment provider's redirect target).
 * Standalone page — it stands in for an external gateway's hosted page, so it
 * deliberately lives outside the dashboard shells.
 */
export default async function WalletCheckoutPage({
  params,
}: {
  params: Promise<{ topupId: string }>;
}) {
  const { topupId } = await params;
  const actor = await requireRole("admin", "teacher", "super_admin");

  let topup;
  try {
    topup = await getTopup(actor, topupId);
  } catch (err) {
    if (err instanceof TopupsServiceError && err.status === 403) redirect("/dashboard");
    notFound();
  }
  if (topup.status === "completed") {
    redirect(actor.role === "teacher" ? "/teacher/wallet" : "/admin/wallet");
  }
  if (topup.status === "cancelled" || topup.status === "failed") {
    redirect(actor.role === "teacher" ? "/teacher/wallet" : "/admin/wallet");
  }

  const school = topup.ownerType === "school" ? await getSchoolById(topup.ownerId).catch(() => null) : null;

  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />
      <main className="gradient-border shadow-lifted relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-card/95 p-8 backdrop-blur-xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
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
            <span className="text-lg font-semibold tracking-tight">Bridge Pay</span>
          </div>
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <LockIcon className="size-3" /> Secure checkout
          </span>
        </div>

        <CheckoutClient
          topupId={topupId}
          tokens={topup.tokens}
          amountUgx={topup.amountUgx}
          amountUsd={topup.amountUsdMicros / 1_000_000}
          walletLabel={topup.ownerType === "school" ? "your school wallet" : "your personal wallet"}
          schoolName={school?.name ?? "Bridge"}
        />

        <p className="text-muted-foreground mt-6 text-center text-[11px]">
          Having trouble?{" "}
          <Link href={actor.role === "teacher" ? "/teacher/wallet" : "/admin/wallet"} className="underline">
            Return to your wallet
          </Link>
        </p>
      </main>
    </div>
  );
}
