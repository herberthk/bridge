import Link from "next/link";
import { GraduationCapIcon, UsersIcon } from "lucide-react";

import type { ClassDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import type { SchoolVerificationStatus } from "@/lib/constants";

export interface ClassWithMeta {
  cls: SerializedWithId<ClassDoc>;
  teacherNames: string[];
}

/** Premium card grid for a school's classes. */
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
            <p className="text-muted-foreground mt-1 text-sm">
              {items.length} class{items.length === 1 ? "" : "es"}
              {typeof header.totalStudents === "number"
                ? ` · ${header.totalStudents} students`
                : ""}
            </p>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
              <GraduationCapIcon className="size-6" />
            </span>
            <p className="font-medium">{emptyTitle}</p>
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">{emptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(({ cls, teacherNames }) => (
            <Card
              key={cls.id}
              className="shadow-card group relative gap-3 overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lifted"
            >
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg">{cls.name}</CardTitle>
                  <Badge variant="secondary" className="shrink-0">
                    {cls.level === "primary" ? "Primary" : cls.secondarySubLevel === "a_level" ? "A level" : "O level"}
                  </Badge>
                </div>
                <CardDescription className="flex items-center gap-1.5">
                  <UsersIcon className="size-3.5" />
                  {cls.studentCount} student{cls.studentCount === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-3">
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
                    New exam
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
