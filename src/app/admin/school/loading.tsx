import { AdminHeaderSkeleton } from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-label="Loading school profile"
    >
      <AdminHeaderSkeleton />
      {/* Profile strength meter */}
      <div className="shadow-card rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-2 w-full rounded-full sm:w-56" />
        </div>
      </div>
      {/* Public details form */}
      <div className="shadow-card rounded-xl border bg-card p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-1.5 h-3.5 w-80 max-w-full" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>
      {/* Verification card */}
      <div className="shadow-card rounded-xl border bg-card p-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-1.5 h-3.5 w-96 max-w-full" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-9 w-44 rounded-lg" />
        </div>
      </div>
      <span className="sr-only">Loading school profile…</span>
    </div>
  );
}
