"use client";

import { useActionState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeftIcon,
  BookOpenCheckIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  PauseIcon,
  SchoolIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";

import { setUserStatusAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { ClassDoc, SchoolDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KpiCard } from "@/components/features/dashboard/charts";
import { useActionToast } from "@/components/features/super/schools-manager";
import { VerifiedBadge } from "@/components/features/school/verified-badge";

interface TeacherDetailProps {
  teacher: SerializedWithId<UserDoc>;
  school: SerializedWithId<SchoolDoc> | null;
  classes: SerializedWithId<ClassDoc>[];
  studentsReached: number;
  examsGenerated: number;
}

/** Super-admin drilldown into one teacher. */
export function SuperTeacherDetailView({
  teacher,
  school,
  classes,
  studentsReached,
  examsGenerated,
}: TeacherDetailProps) {
  const [statusState, statusAction, statusPending] = useActionState<ActionState | null, FormData>(
    setUserStatusAction,
    null,
  );
  useActionToast(statusState, undefined, "Teacher status updated");

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground -ml-2 gap-1.5 font-medium"
        render={<Link href="/super/teachers" />}
      >
        <ArrowLeftIcon className="size-4" />
        <span>Back to teachers</span>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="bg-brand text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-md">
            <UserRoundIcon className="size-6" />
          </span>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {teacher.displayName}
              <Badge
                variant="outline"
                className={
                  teacher.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : teacher.status === "suspended"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }
              >
                {teacher.status}
              </Badge>
            </h1>
            <p className="text-muted-foreground text-sm">{teacher.email}</p>
          </div>
        </div>
        {teacher.status !== "active" ? (
          <form action={statusAction}>
            <input type="hidden" name="userId" value={teacher.id} />
            <input type="hidden" name="status" value="active" />
            <Button type="submit" variant="outline" size="sm" disabled={statusPending}>
              <CircleCheckIcon data-icon="inline-start" />
              Reactivate
            </Button>
          </form>
        ) : (
          <form action={statusAction}>
            <input type="hidden" name="userId" value={teacher.id} />
            <input type="hidden" name="status" value="suspended" />
            <Button type="submit" variant="outline" size="sm" disabled={statusPending}>
              <PauseIcon data-icon="inline-start" />
              Suspend 7 days
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Classes managed" value={classes.length} hint="Assigned by their admin" />
        <KpiCard title="Students reached" value={studentsReached} hint="Across managed classes" accent />
        <KpiCard title="Exams generated" value={examsGenerated} hint="AI exams authored" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SchoolIcon className="size-4" /> School
            </CardTitle>
          </CardHeader>
          <CardContent>
            {school ? (
              <Link href={`/super/schools/${school.id}`} className="hover:bg-accent/60 -m-1 block rounded-lg p-1">
                <p className="text-sm font-medium">{school.name}</p>
                <p className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span className="capitalize">{school.level} school</span>
                  <VerifiedBadge status={school.verification} />
                </p>
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm">Not attached to a school.</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardListIcon className="size-4" /> Managed classes
            </CardTitle>
            <CardDescription>
              {classes.length === 0
                ? "No classes assigned yet."
                : `${classes.length} class${classes.length === 1 ? "" : "es"} under this teacher's management.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Their admin assigns classes — none yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map((c) => (
                  <Badge key={c.id} variant="secondary" className="gap-1.5 px-3 py-1.5">
                    <GraduationCapIcon className="size-3.5" />
                    {c.name}
                    <span className="text-muted-foreground flex items-center gap-0.5 text-xs">
                      <UsersIcon className="size-3" />
                      {c.studentCount}
                    </span>
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheckIcon className="size-4" /> Activity
          </CardTitle>
          <CardDescription>
            {teacher.lastLoginAt
              ? `Last signed in ${format(new Date(teacher.lastLoginAt as unknown as string), "d MMM yyyy, HH:mm")}.`
              : "Has never signed in."}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
