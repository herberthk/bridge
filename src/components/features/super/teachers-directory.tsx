"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Pagination } from "@/components/features/super/pagination";
import { DirectoryToolbar } from "@/components/features/super/students-directory";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import type { PagedResult } from "@/server/services/platform";
import type { UserDoc } from "@/types/firestore";

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  suspended: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  banned: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Platform-wide teachers directory: search, filters, numbered pagination. */
export function TeachersDirectory({
  result,
  schools,
  schoolNames,
}: {
  result: PagedResult<SerializedWithId<UserDoc>>;
  schools: { id: string; name: string }[];
  schoolNames: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {result.total} teacher{result.total === 1 ? "" : "s"} across the platform.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <DirectoryToolbar
            schools={schools}
            showStatus
            searchPlaceholder="Search by name…"
          />
        </CardHeader>
        <CardContent className="p-0">
          {result.items.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-12 text-center text-sm">
              No teachers match these filters.
            </div>
          ) : (
            <div className="divide-y">
              {result.items.map((t) => (
                <div key={t.id} className="hover:bg-accent/40 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.displayName}</p>
                    <p className="text-muted-foreground text-xs">{t.email}</p>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {t.schoolId ? (schoolNames[t.schoolId] ?? "School") : "—"}
                  </div>
                  <Badge variant="outline" className={STATUS_BADGE[t.status] ?? ""}>
                    {t.status}
                  </Badge>
                  <span className="text-muted-foreground hidden text-sm sm:block">
                    {t.createdAt ? format(parseDate(t.createdAt)!, "d MMM yyyy") : "—"}
                  </span>
                  <Button variant="outline" size="sm" render={<Link href={`/super/teachers/${t.id}`} />}>
                    View
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Pagination page={result.page} totalPages={result.totalPages} />
    </div>
  );
}
