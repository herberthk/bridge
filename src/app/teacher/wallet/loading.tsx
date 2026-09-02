import { KpiGridSkeleton, TableSkeleton } from "@/components/features/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-40 rounded-md bg-muted animate-pulse" />
        <div className="h-4 w-56 rounded-md bg-muted animate-pulse" />
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
