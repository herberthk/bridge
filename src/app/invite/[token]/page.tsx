import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2Icon, GraduationCapIcon, MailIcon, ShieldXIcon } from "lucide-react";

import { getInviteForToken } from "@/server/services/invites";
import { AcceptInviteForm } from "@/components/features/auth/accept-invite-form";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept your teacher invite — Bridge",
  robots: { index: false },
};

/**
 * Public invite acceptance screen. The token in the URL is the authority —
 * no session required. Invalid/expired/revoked tokens get a clear dead end.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const decoded = decodeURIComponent(token);

  // Without Firebase credentials there is nothing to look up — show the
  // dead-end state instead of hanging on a query that can never succeed.
  const firebaseConfigured = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  );
  let lookup: Awaited<ReturnType<typeof getInviteForToken>> = {
    error: "This invite link is invalid.",
    status: 404,
  };
  if (firebaseConfigured) {
    // Bound the lookup — an unreachable Firestore must never hang the page.
    lookup = await Promise.race([
      getInviteForToken(decoded),
      new Promise<{ error: string; status: number }>((resolve) =>
        setTimeout(() => resolve({ error: "This invite link is invalid.", status: 504 }), 4000),
      ),
    ]).catch(() => ({ error: "This invite link is invalid.", status: 504 } as const));
  }

  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />

      <main className="gradient-border shadow-lifted relative z-10 w-full max-w-md overflow-hidden rounded-3xl bg-card/95 p-8 backdrop-blur-xl">
        {"error" in lookup ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
              <ShieldXIcon className="size-6" />
            </span>
            <div className="flex flex-col gap-1">
              <h1 className="text-xl font-semibold tracking-tight">Invite unavailable</h1>
              <p className="text-muted-foreground text-sm">{lookup.error}</p>
            </div>
            <Badge variant="outline" className="gap-1">
              <MailIcon className="size-3" />
              Ask your school admin for a fresh link
            </Badge>
            <Link href="/login" className="text-primary text-sm font-medium hover:underline">
              Go to sign in
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5 text-center">
              <span className="bg-brand-soft text-accent-foreground mx-auto flex size-12 items-center justify-center rounded-2xl">
                <GraduationCapIcon className="size-6" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight">
                Join {lookup.invite.schoolName}
              </h1>
              <p className="text-muted-foreground text-sm">
                You&apos;ve been invited to teach on Bridge as{" "}
                <strong className="text-foreground">{lookup.invite.email}</strong>.
                Set up your account below.
              </p>
            </div>

            <AcceptInviteForm token={decoded} />

            <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-center text-[11px]">
              <CheckCircle2Icon className="size-3" />
              This link works once and expires after 7 days.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
