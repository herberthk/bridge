export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";

export default async function SuperHomePage() {
  const user = await requireRole("super_admin");
  return (
    <div className="bg-mesh flex min-h-dvh items-center justify-center p-8">
      <div className="shadow-card rounded-xl border bg-card p-8">
        <h1 className="text-xl font-semibold">Platform dashboard</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Signed in as {user.displayName} ({user.email}). The full dashboard
          arrives in the next milestone.
        </p>
      </div>
    </div>
  );
}
