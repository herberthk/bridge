export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { superDashboard } from "@/server/services/analytics";
import {
  ChartCard,
  CategoryBars,
  KpiCard,
  RevenueArea,
} from "@/components/features/dashboard/charts";
import { formatUsd } from "@/lib/pricing";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Usage, revenue, and adoption across every school.
        </p>
      </div>

      {loadFailed && (
        <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Platform metrics failed to load — figures below may be stale or zero.
          Try refreshing the page.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Revenue (last year)"
          value={data?.revenueUsd ?? 0}
          suffix="USD"
          accent
          hint={data ? formatUsd(data.revenueUsd) : undefined}
        />
        <KpiCard
          title="Active users (7d)"
          value={data?.activeUsers7d ?? 0}
          hint="Signed in this week"
        />
        <KpiCard
          title="Exams taken"
          value={data?.totalAttempts ?? 0}
          hint={`${data?.totalExams ?? 0} exams generated`}
        />
        <KpiCard
          title="Community"
          value={data?.totalSchools ?? 0}
          hint={`${data?.totalAdmins ?? 0} admins · ${data?.totalStudents ?? 0} students`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue trend" description="Daily AI consumption (USD)">
          {(data?.revenueByDay?.length ?? 0) > 1 ? (
            <RevenueArea data={data!.revenueByDay} xKey="date" yKey="usd" label="USD" />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Revenue appears as schools consume tokens.
            </p>
          )}
        </ChartCard>
        <ChartCard title="Exams by subject" description="Platform-wide generation">
          {(data?.attemptsBySubject?.length ?? 0) > 0 ? (
            <CategoryBars
              data={data!.attemptsBySubject}
              xKey="subject"
              yKey="attempts"
              label="Exams"
              vertical
            />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No exams generated yet.
            </p>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Browsers" description="From login analytics">
          {(data?.byBrowser?.length ?? 0) > 0 ? (
            <CategoryBars data={data!.byBrowser} xKey="browser" yKey="count" label="Logins" vertical />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Browser analytics appear after logins.
            </p>
          )}
        </ChartCard>
        <ChartCard title="Devices" description="From login analytics">
          {(data?.byDevice?.length ?? 0) > 0 ? (
            <CategoryBars data={data!.byDevice} xKey="device" yKey="count" label="Logins" vertical />
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">
              Device analytics appear after logins.
            </p>
          )}
        </ChartCard>
      </div>

      <p className="text-muted-foreground text-xs">
        Token consumption tracked: {(data?.tokensConsumed ?? 0).toLocaleString()} tokens ·
        IP addresses and locations are recorded per-login in the audit log.
      </p>
    </div>
  );
}
