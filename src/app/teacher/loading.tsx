import { KpiGridSkeleton, TableSkeleton } from "@/components/features/dashboard/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the teacher dashboard layout (hero + KPIs + class grid + exams). */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="rounded-2xl border p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-2xl" />
            <div>
              <Skeleton className="h-5 w-32 rounded-full" />
              <Skeleton className="mt-2 h-7 w-52" />
              <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
        </div>
      </div>
      <KpiGridSkeleton />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10">
            <Skeleton className="h-1 w-full rounded-none" />
            <div className="flex gap-3 p-5">
              <Skeleton className="size-10 shrink-0 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/3" />
              </div>
            </div>
            <div className="px-5 pb-4">
              <Skeleton className="h-3.5 w-40" />
            </div>
          </li>
        ))}
      </ul>
      <TableSkeleton rows={4} />
    </div>
  );
}
