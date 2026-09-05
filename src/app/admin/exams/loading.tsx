import {
  AdminHeaderSkeleton,
  KpiGridSkeleton,
  TableSkeleton,
} from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading exam library"
    >
      <AdminHeaderSkeleton />
      <KpiGridSkeleton cards={4} />
      {/* Search + filter toolbar */}
      <div className="shadow-card rounded-xl border bg-card p-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>
      <TableSkeleton rows={6} />
      <span className="sr-only">Loading exam library…</span>
    </div>
  );
}
