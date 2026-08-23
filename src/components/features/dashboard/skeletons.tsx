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
