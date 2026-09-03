"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  GraduationCapIcon,
  LineChartIcon,
  PauseIcon,
  SchoolIcon,
} from "lucide-react";

import { setUserStatusAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { AttemptDoc, ClassDoc, SchoolDoc, UserDoc } from "@/types/firestore";
import type { Serialized, SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useActionToast } from "@/components/features/super/schools-manager";
import { KpiCard } from "@/components/features/dashboard/charts";

interface StudentDetailProps {
  student: SerializedWithId<UserDoc>;
  school: SerializedWithId<SchoolDoc> | null;
  classInfo: SerializedWithId<ClassDoc> | null;
  attempts: { attempt: SerializedWithId<AttemptDoc>; examTitle: string }[];
  stats: { taken: number; graded: number; average: number | null; best: number | null };
}

/** Super-admin, read-only drilldown into one student — performance included. */
export function SuperStudentDetailView({
  student,
  school,
  classInfo,
  attempts,
  stats,
}: StudentDetailProps) {
  const [statusState, statusAction, statusPending] = useActionState<ActionState | null, FormData>(
    setUserStatusAction,
    null,
  );
  useActionToast(statusState, undefined, "Student status updated");

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground -ml-2 gap-1.5 font-medium"
        render={<Link href="/super/students" />}
      >
        <ArrowLeftIcon className="size-4" />
        <span>Back to students</span>
      </Button>

      {/* Identity */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="bg-brand text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-md">
            <GraduationCapIcon className="size-6" />
          </span>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {student.displayName}
              <Badge
                variant="outline"
                className={
                  student.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : student.status === "suspended"
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }
              >
                {student.status}
              </Badge>
            </h1>
            <p className="text-muted-foreground text-sm">{student.email}</p>
          </div>
        </div>
        <StatusActions
          studentId={student.id}
          status={student.status}
          action={statusAction}
          pending={statusPending}
        />
      </div>

      {/* Performance KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Attempts taken" value={stats.taken} hint="All time" />
        <KpiCard title="Graded" value={stats.graded} hint="Results finalized" />
        <KpiCard
          title="Average score"
          value={stats.average ?? 0}
          suffix={stats.average === null ? "" : "%"}
          hint={stats.average === null ? "No graded attempts" : "Across graded attempts"}
          accent
        />
        <KpiCard
          title="Best score"
          value={stats.best ?? 0}
          suffix={stats.best === null ? "" : "%"}
          hint={stats.best === null ? "No graded attempts" : "Single attempt"}
        />
      </div>

      {/* Context cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SchoolIcon className="size-4" /> School
            </CardTitle>
          </CardHeader>
          <CardContent>
            {school ? (
              <Link
                href={`/super/schools/${school.id}`}
                className="hover:bg-accent/60 -m-1 flex items-center justify-between rounded-lg p-1"
              >
                <div>
                  <p className="text-sm font-medium">{school.name}</p>
                  <p className="text-muted-foreground text-xs capitalize">{school.level} school</p>
                </div>
                <Badge variant="outline" className="capitalize">
                  {school.verification}
                </Badge>
              </Link>
            ) : (
              <p className="text-muted-foreground text-sm">
                No school — standalone household (parent/tutor managed).
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCapIcon className="size-4" /> Class
            </CardTitle>
          </CardHeader>
          <CardContent>
            {classInfo ? (
              <div>
                <p className="text-sm font-medium">{classInfo.name}</p>
                <p className="text-muted-foreground text-xs">
                  {classInfo.studentCount} students in class ·{" "}
                  {classInfo.secondarySubLevel === "a_level" ? "A level" : classInfo.level === "primary" ? "Primary" : "O level"}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Not assigned to a class yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attempt history */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChartIcon className="size-4" /> Attempt history
          </CardTitle>
          <CardDescription>Most recent 25 attempts, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {attempts.length === 0 ? (
            <p className="text-muted-foreground p-8 text-center text-sm">No attempts yet.</p>
          ) : (
            <div className="divide-y">
              {attempts.map(({ attempt, examTitle }) => (
                <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{examTitle}</p>
                    <p className="text-muted-foreground text-xs">
                      {attempt.submittedAt
                        ? format(new Date(attempt.submittedAt as unknown as string), "d MMM yyyy, HH:mm")
                        : "Not submitted"}
                      {attempt.retakeOf ? " · retake" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="capitalize">
                      {attempt.status}
                    </Badge>
                    <span className="text-sm font-semibold tabular-nums">
                      {attempt.score ? `${attempt.score.percentage}%` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusActions({
  studentId,
  status,
  action,
  pending,
}: {
  studentId: string;
  status: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  return (
    <div className="flex gap-2">
      {status !== "active" && (
        <form action={action}>
          <input type="hidden" name="userId" value={studentId} />
          <input type="hidden" name="status" value="active" />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            <CircleCheckIcon data-icon="inline-start" />
            Reactivate
          </Button>
        </form>
      )}
      {status === "active" && (
        <form action={action}>
          <input type="hidden" name="userId" value={studentId} />
          <input type="hidden" name="status" value="suspended" />
          <input
            type="hidden"
            name="suspendedUntil"
            value={new Date(Date.now() + 7 * 86400_000).toISOString()}
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            <PauseIcon data-icon="inline-start" />
            Suspend 7 days
          </Button>
        </form>
      )}
    </div>
  );
}
