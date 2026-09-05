import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the results hero shape (header → score panel → stat strip → cards)
 * so the swap from skeleton to content doesn't shift layout.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 sm:gap-6" aria-busy="true">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Skeleton className="mt-0.5 size-8 rounded-lg" />
          <div>
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-7 w-56 sm:w-72" />
            <Skeleton className="mt-2 h-4 w-64" />
          </div>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>

      {/* Score hero */}
      <div className="overflow-hidden rounded-3xl border">
        <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center">
          <Skeleton className="size-36 shrink-0 rounded-full sm:size-40" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-3 h-5 w-64" />
            <Skeleton className="mt-4 h-2 w-full max-w-xl rounded-full" />
            <Skeleton className="mt-3 h-4 w-3/4 max-w-xl" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t p-4 sm:p-5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[7.5rem] rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Body cards */}
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
