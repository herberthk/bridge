import {
  AdminHeaderSkeleton,
  TableSkeleton,
} from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading retake requests"
    >
      <AdminHeaderSkeleton />
      {/* Search + sort toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      {/* Request cards */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="shadow-card flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-start"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-40 rounded-md" />
              </div>
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
      {/* Decision history */}
      <TableSkeleton rows={4} withTitle />
      <span className="sr-only">Loading retake requests…</span>
    </div>
  );
}
