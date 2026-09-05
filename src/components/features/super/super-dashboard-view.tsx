"use client";

import Link from "next/link";
import {
  BadgeCheckIcon,
  BanknoteIcon,
  Building2Icon,
  CoinsIcon,
  GraduationCapIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UserRoundIcon,
} from "lucide-react";

import type { SuperDashboardData } from "@/server/services/analytics";
import { KpiCard, CategoryBars, ChartCard, RevenueArea } from "@/components/features/dashboard/charts";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTokens, formatUgx } from "@/lib/pricing";

/**
 * Super-admin platform dashboard: revenue, consumption, growth, schools,
 * verification queue — the decision-making surface. No exam-performance data:
 * pedagogy belongs to the schools.
 */
export function SuperDashboardView({ data }: { data: SuperDashboardData }) {
  const { totals, newThisWeek } = data;

  return (
    <div className="flex flex-col gap-6">
      {/* ── KPI grid ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Platform revenue (all time)"
          value={data.revenue.usd}
          suffix=" USD"
          hint={`${formatUgx(data.revenue.ugx)} · pay-as-you-go`}
          accent
        />
        <KpiCard
          title="Tokens consumed"
          value={data.tokensConsumed}
          hint="AI generation + grading (365d)"
        />
        <KpiCard
          title="Schools"
          value={totals.schools}
          hint={`${totals.verifiedSchools} verified · ${totals.pendingVerifications} pending review`}
        />
        <KpiCard title="Active users (7d)" value={data.activeUsers7d} hint="Signed in this week" />
        <KpiCard
          title="Students"
          value={totals.students}
          hint={`${newThisWeek.students} new this week`}
        />
        <KpiCard
          title="Teachers"
          value={totals.teachers}
          hint={`${newThisWeek.teachers} new this week`}
        />
        <KpiCard
          title="School admins"
          value={totals.admins}
          hint={`${totals.standaloneAdmins} standalone (parent/tutor)`}
        />
        <div className="bg-brand shadow-glow relative overflow-hidden rounded-xl p-5 text-primary-foreground">
          <p className="text-sm opacity-80">Growth (7d)</p>
          <p className="mt-1.5 flex items-baseline gap-1.5 text-3xl font-semibold">
            <TrendingUpIcon className="size-6" />
            {newThisWeek.students + newThisWeek.teachers + newThisWeek.schools}
          </p>
          <p className="mt-1 text-xs opacity-70">
            {newThisWeek.schools} new school{newThisWeek.schools === 1 ? "" : "s"} registered
          </p>
        </div>
      </div>

      {/* ── Revenue & consumption ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue (30 days)" description="Daily pay-as-you-go revenue in USD.">
          {data.revenueByDay.length ? (
            <RevenueArea data={data.revenueByDay} xKey="date" yKey="usd" label="Revenue (USD)" />
          ) : (
            <EmptyChart icon={<BanknoteIcon className="size-8" />} text="No revenue recorded yet." />
          )}
        </ChartCard>
        <ChartCard title="Token consumption (30 days)" description="AI tokens spent per day across the platform.">
          {data.tokensByDay.length ? (
            <CategoryBars data={data.tokensByDay} xKey="date" yKey="tokens" label="Tokens" />
          ) : (
            <EmptyChart icon={<CoinsIcon className="size-8" />} text="No consumption recorded yet." />
          )}
        </ChartCard>
      </div>

      {/* ── Audience + verification queue ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Browsers (30 days)" description="Where users sign in from.">
          {data.browsers.length ? (
            <CategoryBars
              data={data.browsers}
              xKey="name"
              yKey="count"
              label="Sign-ins"
              vertical
              height="h-48"
            />
          ) : (
            <EmptyChart icon={<UserRoundIcon className="size-8" />} text="No sign-in data yet." />
          )}
        </ChartCard>
        <ChartCard title="Devices (30 days)" description="Desktop vs mobile vs tablet.">
          {data.devices.length ? (
            <CategoryBars
              data={data.devices}
              xKey="name"
              yKey="count"
              label="Sign-ins"
              vertical
              height="h-48"
            />
          ) : (
            <EmptyChart icon={<UserRoundIcon className="size-8" />} text="No sign-in data yet." />
          )}
        </ChartCard>

        {/* Verification queue */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-sky-500" />
              Verification queue
            </CardTitle>
            <CardDescription>
              {totals.pendingVerifications === 0
                ? "No schools waiting for the blue tick."
                : `${totals.pendingVerifications} school${totals.pendingVerifications === 1 ? "" : "s"} awaiting review.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {data.verificationQueue.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center text-sm">
                <BadgeCheckIcon className="text-muted-foreground/40 size-8" />
                All caught up.
              </div>
            ) : (
              <div className="divide-y">
                {data.verificationQueue.map((s) => (
                  <Link
                    key={s.id}
                    href={`/super/schools/${s.id}`}
                    className="hover:bg-accent/40 flex items-center justify-between gap-3 px-6 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-muted-foreground text-xs capitalize">{s.level} school</p>
                    </div>
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="secondary">
                      Review
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Top schools by consumption ── */}
      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Building2Icon className="size-4" />
              Top schools by token consumption
            </CardTitle>
            <CardDescription>Your heaviest platform users — and their remaining balance.</CardDescription>
          </div>
          <Button variant="outline" size="sm" render={<Link href="/super/schools" />}>
            <Building2Icon data-icon="inline-start" className="size-4" />
            All schools
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.topSchools.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
              <GraduationCapIcon className="text-muted-foreground/40 size-8" />
              No active schools yet.
            </div>
          ) : (
            <div className="divide-y">
              {data.topSchools.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/super/schools/${s.id}`}
                  className="hover:bg-accent/40 flex items-center gap-4 px-6 py-3.5"
                >
                  <span className="text-muted-foreground w-6 text-center text-sm font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {s.name}
                      <VerifiedBadge status={s.verification as "verified" | "pending" | "unverified"} />
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {s.students} students · {s.staff} staff ·{" "}
                      <span className="capitalize">{s.level}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {formatTokens(s.tokensConsumed)}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {formatTokens(s.balanceTokens)} left
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="text-muted-foreground flex h-56 flex-col items-center justify-center gap-2 text-sm">
      <span className="text-muted-foreground/40">{icon}</span>
      {text}
    </div>
  );
}
