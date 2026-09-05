import { ChartSkeleton, KpiGridSkeleton } from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the dashboard shape (header → hero → KPIs → lists → charts) so the
 * swap from skeleton to content doesn't shift layout.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8" aria-busy="true">
      <div>
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="mt-2 h-8 w-64 sm:w-80" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="h-36 w-full rounded-3xl" />
      <KpiGridSkeleton cards={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}
