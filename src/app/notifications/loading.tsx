import { TableSkeleton } from "@/components/features/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-7 w-48 animate-pulse rounded-md" />
        <div className="bg-muted h-4 w-56 animate-pulse rounded-md" />
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
