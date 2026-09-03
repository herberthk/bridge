"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { SearchIcon, XIcon } from "lucide-react";

import type { PagedResult } from "@/server/services/platform";
import type { UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pagination } from "@/components/features/super/pagination";
import { parseDate } from "@/lib/serialize";

export interface DirectorySchoolOption {
  id: string;
  name: string;
}

function useDirectoryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page"); // any filter change resets pagination
    router.push(`${pathname}?${next.toString()}`);
  };
  return { params, setParam };
}

/** Search + filter toolbar shared by the platform directories. */
export function DirectoryToolbar({
  schools,
  showStatus,
  searchPlaceholder,
}: {
  schools: DirectorySchoolOption[];
  showStatus: boolean;
  searchPlaceholder: string;
}) {
  const { params, setParam } = useDirectoryNav();
  const search = params.get("q") ?? "";
  const schoolFilter = params.get("school");
  const statusFilter = params.get("status");
  const [value, setValue] = useState(search);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <form
        className="relative flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q: value || null });
        }}
      >
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={searchPlaceholder}
          className="pr-9 pl-9"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setParam({ q: null });
            }}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            aria-label="Clear search"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </form>
      <div className="flex gap-2">
        <Select
          value={schoolFilter ?? "all"}
          onValueChange={(v) => setParam({ school: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All schools" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All schools</SelectItem>
            {schools.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showStatus && (
          <Select
            value={statusFilter ?? "all"}
            onValueChange={(v) => setParam({ status: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  suspended: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  banned: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Platform-wide students directory: search, school/status filters, pages. */
export function StudentsDirectory({
  result,
  schools,
  schoolNames,
}: {
  result: PagedResult<SerializedWithId<UserDoc>>;
  schools: DirectorySchoolOption[];
  schoolNames: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {result.total} student{result.total === 1 ? "" : "s"} across the platform.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <DirectoryToolbar schools={schools} showStatus searchPlaceholder="Search by name…" />
        </CardHeader>
        <CardContent className="p-0">
          <StudentsTable items={result.items} schoolNames={schoolNames} />
        </CardContent>
      </Card>
      <Pagination page={result.page} totalPages={result.totalPages} />
    </div>
  );
}

function StudentsTable({
  items,
  schoolNames,
}: {
  items: SerializedWithId<UserDoc>[];
  schoolNames: Record<string, string>;
}) {
  return items.length === 0 ? (
    <div className="text-muted-foreground flex flex-col items-center gap-2 p-12 text-center text-sm">
      No students match these filters.
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs tracking-wide uppercase">
            <th className="px-6 py-3 font-medium">Student</th>
            <th className="px-6 py-3 font-medium">School</th>
            <th className="px-6 py-3 font-medium">Class</th>
            <th className="px-6 py-3 font-medium">Status</th>
            <th className="px-6 py-3 font-medium">Joined</th>
            <th className="px-6 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((s) => (
            <tr key={s.id} className="hover:bg-accent/40">
              <td className="px-6 py-3">
                <p className="font-medium">{s.displayName}</p>
                <p className="text-muted-foreground text-xs">{s.email}</p>
              </td>
              <td className="text-muted-foreground px-6 py-3 text-sm">
                {s.schoolId ? (schoolNames[s.schoolId] ?? "School") : "—"}
              </td>
              <td className="text-muted-foreground px-6 py-3 text-sm">
                {s.classLevel
                  ? `${s.level === "primary" ? "P" : "S"}${s.classLevel}`
                  : "—"}
              </td>
              <td className="px-6 py-3">
                <Badge variant="outline" className={STATUS_BADGE[s.status] ?? ""}>
                  {s.status}
                </Badge>
              </td>
              <td className="text-muted-foreground px-6 py-3 text-sm">
                {s.createdAt ? format(parseDate(s.createdAt)!, "d MMM yyyy") : "—"}
              </td>
              <td className="px-6 py-3 text-right">
                <Button variant="outline" size="sm" render={<Link href={`/super/students/${s.id}`} />}>
                  View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
