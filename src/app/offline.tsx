import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "You're offline" };

export default function OfflinePage() {
  return (
    <div className="bg-mesh flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="bg-brand shadow-glow flex size-14 items-center justify-center rounded-2xl text-2xl text-primary-foreground">
        ⚡
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">
        You&apos;re offline
      </h1>
      <p className="text-muted-foreground max-w-sm text-pretty">
        Bridge needs an internet connection for exams and AI features. Reconnect
        and try again — your progress is saved where possible.
      </p>
      <Button render={<Link href="/" />}>Retry</Button>
    </div>
  );
}
