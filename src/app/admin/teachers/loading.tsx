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
      aria-label="Loading teachers"
    >
      <AdminHeaderSkeleton />
      {/* Insight strip: roster counts */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-4 w-64" />
      </div>
      {/* Roster card with search */}
      <TableSkeleton rows={5} withTitle />
      {/* Pending invites card */}
      <TableSkeleton rows={2} withTitle />
      <span className="sr-only">Loading teachers…</span>
    </div>
  );
}
