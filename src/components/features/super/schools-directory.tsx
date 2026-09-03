"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Building2Icon, ChevronRightIcon } from "lucide-react";

import type { PagedResult } from "@/server/services/platform";
import type { SchoolDoc } from "@/types/firestore";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Pagination } from "@/components/features/super/pagination";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { parseDate, type SerializedWithId } from "@/lib/serialize";

/** Super-admin schools directory: search, level/verification filters, pages. */
export function SchoolsDirectory({
  result,
}: {
  result: PagedResult<SerializedWithId<SchoolDoc>>;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader className="sr-only">
        <Building2Icon />
        Schools
      </CardHeader>
      <CardContent className="p-0">
        {result.items.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 p-12 text-center text-sm">
            <Building2Icon className="text-muted-foreground/40 size-8" />
            No schools match these filters.
          </div>
        ) : (
          <div className="divide-y">
            {result.items.map((school) => (
              <Link
                key={school.id}
                href={`/super/schools/${school.id}`}
                className="hover:bg-accent/40 group flex items-center gap-4 px-6 py-4"
              >
                <span className="bg-brand-soft text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
                  <Building2Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {school.name}
                    <VerifiedBadge status={school.verification} />
                  </p>
                  <p className="text-muted-foreground text-xs">
                    <span className="capitalize">{school.level ?? "—"}</span> ·{" "}
                    {school.studentCount ?? 0} students ·{" "}
                    {(school.adminCount ?? 0) + (school.teacherCount ?? 0)} staff ·{" "}
                    {school.createdAt ? format(parseDate(school.createdAt)!, "d MMM yyyy") : "—"}
                  </p>
                </div>
                {school.verification === "pending" && (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="secondary">
                    Review
                  </Badge>
                )}
                <ChevronRightIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function useSchoolsNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return { params, setParam };
}

/** Name search + level/verification filters for the schools directory. */
export function SchoolsToolbar() {
  const { params, setParam } = useSchoolsNav();
  const search = params.get("q") ?? "";
  const level = params.get("level");
  const verification = params.get("verification");
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
          placeholder="Search schools by name…"
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
        <Select value={level ?? "all"} onValueChange={(v) => setParam({ level: v === "all" ? null : v })}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Any level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any level</SelectItem>
            <SelectItem value="primary">Primary</SelectItem>
            <SelectItem value="secondary">Secondary</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={verification ?? "all"}
          onValueChange={(v) => setParam({ verification: v === "all" ? null : v })}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Any verification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any verification</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
