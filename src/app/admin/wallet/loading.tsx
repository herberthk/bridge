import {
  KpiGridSkeleton,
  TableSkeleton,
} from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading wallet"
    >
      {/* Page header: icon + title + badge + dialogs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-12 shrink-0 rounded-2xl" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>
      {/* Balance hero + inflow / burn cards */}
      <KpiGridSkeleton cards={3} />
      {/* Pricing banner */}
      <Skeleton className="h-12 w-full rounded-xl" />
      {/* Transaction ledger with filters */}
      <TableSkeleton rows={6} withTitle />
      <span className="sr-only">Loading wallet…</span>
    </div>
  );
}
