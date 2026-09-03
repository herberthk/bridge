export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { superDashboard } from "@/server/services/analytics";
import { SuperDashboardView } from "@/components/features/super/super-dashboard-view";

export default async function SuperHomePage() {
  await requireRole("super_admin");

  let data: Awaited<ReturnType<typeof superDashboard>> | null = null;
  let loadFailed = false;
  try {
    data = await superDashboard();
  } catch (err) {
    console.error("[super dashboard] load failed", err);
    loadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load platform analytics</p>
          <p className="mt-0.5 text-xs text-destructive/80">
            Some data could not be fetched from the database. Please try refreshing the page.
          </p>
        </div>
      )}
      {data && <SuperDashboardView data={data} />}
    </div>
  );
}
