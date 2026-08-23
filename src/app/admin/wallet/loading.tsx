import { KpiGridSkeleton, TableSkeleton } from "@/components/features/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <KpiGridSkeleton cards={3} />
      <TableSkeleton rows={6} withTitle />
    </div>
  );
}
