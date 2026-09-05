import { AdminHeaderSkeleton } from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading voice builder"
    >
      <AdminHeaderSkeleton withActions={false} />
      {/* How-it-works steps */}
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Talk panel */}
        <div className="shadow-card overflow-hidden rounded-xl border bg-card">
          <Skeleton className="h-72 w-full rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        {/* Draft spec panel */}
        <div className="shadow-card rounded-xl border bg-card p-5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-1.5 h-3.5 w-48" />
          <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-10 w-full rounded-lg" />
        </div>
      </div>
      <span className="sr-only">Loading voice builder…</span>
    </div>
  );
}
