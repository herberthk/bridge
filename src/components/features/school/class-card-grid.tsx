import Link from "next/link";
import {
  ArrowUpRightIcon,
  FilePlus2Icon,
  GraduationCapIcon,
  UsersIcon,
} from "lucide-react";

import type { ClassDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import type { SchoolVerificationStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface ClassWithMeta {
  cls: SerializedWithId<ClassDoc>;
  teacherNames: string[];
}

function levelLabel(cls: SerializedWithId<ClassDoc>): string {
  if (cls.level === "primary") return "Primary";
  return cls.secondarySubLevel === "a_level" ? "A level" : "O level";
}

/** Two-letter monogram for the class avatar (e.g. "Primary 1" → "P1"). */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "CL").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase() || "CL";
}

/**
 * Premium card grid for a school's classes.
 * Server-rendered (no client JS): hover/focus affordances are CSS-only and
 * off-screen cards defer rendering via content-visibility.
 */
export function ClassCardGrid({
  items,
  basePath,
  emptyTitle = "No classes yet",
  emptyHint = "Create your first class to start adding students and generating exams.",
  header,
}: {
  items: ClassWithMeta[];
  basePath: "/admin" | "/teacher";
  emptyTitle?: string;
  emptyHint?: string;
  header?: {
    schoolName?: string;
    verification?: SchoolVerificationStatus | null;
    totalStudents?: number;
  };
}) {
  return (
    <div className="flex flex-col gap-6">
      {header && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              Classes
              {header.schoolName ? (
                <span className="text-muted-foreground text-base font-normal">
                  at {header.schoolName}
                </span>
              ) : null}
              {header.verification ? (
                <VerifiedBadge status={header.verification} />
              ) : null}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm tabular-nums">
              {items.length} class{items.length === 1 ? "" : "es"}
              {typeof header.totalStudents === "number"
                ? ` · ${header.totalStudents} students`
                : ""}
            </p>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <Card className="shadow-card relative overflow-hidden">
          <div aria-hidden className="bg-brand-soft pointer-events-none absolute inset-0" />
          <CardContent className="relative flex flex-col items-center gap-3 p-12 text-center">
            <span className="bg-brand text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-md">
              <GraduationCapIcon className="size-6" aria-hidden />
            </span>
            <p className="text-base font-semibold tracking-tight">{emptyTitle}</p>
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">{emptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(({ cls, teacherNames }) => (
            <li
              key={cls.id}
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 248px" }}
              className="min-w-0"
            >
              <Card
                className={cn(
                  "shadow-card group relative h-full gap-0 overflow-hidden py-0",
                  "transition-[transform,box-shadow,border-color] duration-200",
                  "hover:-translate-y-0.5 hover:shadow-lifted focus-within:shadow-lifted",
                )}
              >
                <div aria-hidden className="bg-brand h-1 w-full opacity-90" />
                <CardHeader className="pt-4 pb-0">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className="bg-brand-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold tracking-tight"
                    >
                      {monogram(cls.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="truncate text-[1.05rem]">{cls.name}</CardTitle>
                        <Badge variant="secondary" className="shrink-0">
                          {levelLabel(cls)}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1 flex items-center gap-1.5 tabular-nums">
                        <UsersIcon className="size-3.5" aria-hidden />
                        {cls.studentCount} student{cls.studentCount === 1 ? "" : "s"}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-4 px-5 pt-3 pb-5">
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {teacherNames.length
                      ? `Teachers: ${teacherNames.join(", ")}`
                      : "No teacher assigned yet"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      render={<Link href={`${basePath}/classes/${cls.id}`} />}
                    >
                      Open class
                      <ArrowUpRightIcon data-icon="inline-end" aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      render={
                        <Link
                          href={`${basePath}/generate?level=${cls.level}&sublevel=${cls.secondarySubLevel ?? "o_level"}&classLevel=${cls.classLevel}&classId=${cls.id}&className=${encodeURIComponent(cls.name)}`}
                        />
                      }
                    >
                      <FilePlus2Icon data-icon="inline-start" aria-hidden />
                      New exam
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small helper for dashboards: derive teacher display names from staff docs. */
export function teacherNamesForClass(
  cls: SerializedWithId<ClassDoc>,
  staff: SerializedWithId<UserDoc>[],
): string[] {
  const ids = new Set(cls.teacherIds ?? []);
  return staff.filter((t) => ids.has(t.id)).map((t) => t.displayName);
}
