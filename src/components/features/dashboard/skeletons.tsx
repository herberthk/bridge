import { Skeleton } from "@/components/ui/skeleton";

/** KPI stat cards row — matches the KpiCard grid on dashboards. */
export function KpiGridSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="shadow-card rounded-xl border bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-16" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Data table placeholder — header strip + shimmering rows. */
export function TableSkeleton({ rows = 6, withTitle = true }: { rows?: number; withTitle?: boolean }) {
  return (
    <div className="shadow-card rounded-xl border bg-card">
      {withTitle && (
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="h-3 w-6" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/5" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Chart card placeholder — title + plot area. */
export function ChartSkeleton() {
  return (
    <div className="shadow-card rounded-xl border bg-card p-5">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-1 h-3 w-52" />
      <div className="bg-shimmer bg-muted/40 mt-4 h-56 rounded-lg" />
    </div>
  );
}

/** Full dashboard: heading + KPI row + two charts. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>
      <KpiGridSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

/** Student exams hub — mirrors `exams/page.tsx` header + toolbar + cards + rows. */
export function StudentExamsSkeleton() {
  return (
    <div
      className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8"
      role="status"
      aria-label="Loading exams"
    >
      {/* Header: eyebrow + title + stat pills */}
      <div>
        <Skeleton className="h-3 w-32" />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </div>
      </div>

      {/* Toolbar: search + tabs + selects */}
      <div className="rounded-3xl border bg-card p-4 shadow-card sm:p-5">
        <Skeleton className="h-11 w-full rounded-2xl" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-2xl bg-muted/60 p-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-xl" />
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>
      </div>

      {/* Upcoming cards */}
      <div>
        <Skeleton className="mb-3 h-3 w-44" />
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-3xl border bg-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 shrink-0 rounded-2xl" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-2xl border bg-muted/40 p-2.5">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex flex-col items-center gap-1.5 px-2">
                    <Skeleton className="h-2.5 w-10" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-4 h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>

      {/* Completed rows */}
      <div>
        <Skeleton className="mb-3 h-3 w-36" />
        <div className="overflow-hidden rounded-3xl border bg-card shadow-card">
          <div className="flex flex-col gap-4 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="size-10 shrink-0 rounded-2xl" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <div className="flex w-28 shrink-0 flex-col gap-1.5 sm:w-32">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading exams…</span>
    </div>
  );
}

/** Student results — mirrors `results/page.tsx` header + KPIs + ring rows. */
export function StudentResultsSkeleton() {
  return (
    <div
      className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8"
      role="status"
      aria-label="Loading results"
    >
      {/* Header */}
      <div>
        <Skeleton className="h-3 w-40" />
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 shadow-card">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="mt-2.5 h-8 w-16" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Ring rows */}
      <div className="overflow-hidden rounded-3xl border bg-card shadow-card">
        <div className="flex flex-col gap-4 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-14 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="size-4 shrink-0" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading results…</span>
    </div>
  );
}

/** Card grid for student "up next" exam tiles. */
export function ExamCardsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="shadow-card rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex w-full flex-col gap-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-3 w-28" />
          <Skeleton className="mt-4 h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
