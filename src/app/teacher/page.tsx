export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookOpenCheckIcon,
  FilePlus2Icon,
  GraduationCapIcon,
  SchoolIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getSchoolById } from "@/server/services/schools";
import { listClasses } from "@/server/services/classes";
import { countExams, listRecentExamsForClasses } from "@/server/services/exams";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classLevelLabel, classMonogram } from "@/lib/class-display";

/**
 * Server-rendered KPI card — no client JS, no animation runtime.
 * (Deliberately not `KpiCard`: that island pulls recharts + a counter into
 * the dashboard bundle for numbers that render once.)
 */
function StatCard({
  icon,
  title,
  value,
  hint,
  accent,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl p-5",
        accent
          ? "bg-brand shadow-glow text-primary-foreground"
          : "shadow-card border bg-card",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            accent ? "bg-white/15 text-primary-foreground" : "bg-brand-soft text-primary",
          )}
        >
          {icon}
        </span>
        <p className={cn("text-sm", accent ? "opacity-80" : "text-muted-foreground")}>{title}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className={cn("mt-1 text-xs", accent ? "opacity-70" : "text-muted-foreground")}>{hint}</p>
    </div>
  );
}

/**
 * Teacher dashboard: the school in context, the classes they manage and
 * quick links into the exam workflow. Fully server-rendered — the only
 * client JS on this route is the shadcn button/link islands.
 */
export default async function TeacherDashboardPage() {
  const actor = await requireRole("teacher");

  const [classes, examCount, school] = await Promise.all([
    // Assigned-only for teachers, so every card below is openable.
    listClasses(actor),
    countExams(actor),
    actor.schoolId
      ? getSchoolById(actor.schoolId)
      : Promise.resolve(null),
  ]);

  const studentCount = classes.reduce((n, c) => n + (c.studentCount ?? 0), 0);
  const firstName = actor.displayName.trim().split(/\s+/)[0] || "there";

  // Single-pass join: index classes once instead of scanning per exam.
  const classById = new Map(classes.map((c) => [c.id, c]));
  // A preview strip, so a capped scan is fine — `partial` only matters on
  // pages that present a complete list.
  const recentExams = await listRecentExamsForClasses(actor, [...classById.keys()]);
  const classExams = recentExams.exams.map((exam) => ({
    exam,
    class: classById.get(exam.classId!) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <section className="bg-mesh relative overflow-hidden rounded-2xl border">
        <div aria-hidden className="bg-brand-soft pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center justify-between gap-5 p-6 sm:p-7">
          <div className="flex min-w-0 items-center gap-4">
            <span className="bg-brand text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-md">
              <SchoolIcon className="size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-1.5">
                Teacher overview
              </Badge>
              <h1 className="truncate text-xl font-semibold tracking-tight text-balance sm:text-2xl">
                Welcome back, {firstName}
              </h1>
              <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
                <span className="max-w-56 truncate font-medium text-foreground">
                  {school?.name ?? "Your school"}
                </span>
                {school ? <VerifiedBadge status={school.verification} /> : null}
                <span aria-hidden>·</span>
                <span className="tabular-nums">
                  {classes.length} class{classes.length === 1 ? "" : "es"} assigned
                </span>
                <span aria-hidden>·</span>
                <span>{school ? (school.level === "primary" ? "Primary" : "Secondary") : "—"}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button render={<Link href="/teacher/classes" />} className="shadow-glow">
              <SparklesIcon data-icon="inline-start" aria-hidden />
              Generate exam
            </Button>
          </div>
        </div>
      </section>

      {/* KPIs — static server markup, no AnimatedCounter/recharts weight */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<BookOpenCheckIcon className="size-4.5" aria-hidden />}
          title="My classes"
          value={classes.length}
          hint="Assigned by your admin"
        />
        <StatCard
          icon={<UsersIcon className="size-4.5" aria-hidden />}
          title="Students"
          value={studentCount}
          hint="Across your classes"
        />
        <StatCard
          icon={<FilePlus2Icon className="size-4.5" aria-hidden />}
          title="Exams"
          value={examCount}
          hint="In your school"
        />
        <StatCard
          accent
          icon={<GraduationCapIcon className="size-4.5" aria-hidden />}
          title="School level"
          value={school ? (school.level === "primary" ? "Primary" : "Secondary") : "—"}
          hint="Single curriculum track"
        />
      </div>

      {/* My classes */}
      <section aria-labelledby="teacher-classes-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="teacher-classes-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            My classes
            <Badge variant="secondary" className="tabular-nums">
              {classes.length}
            </Badge>
          </h2>
          <Button variant="ghost" size="sm" render={<Link href="/teacher/classes" />}>
            View all
            <ArrowRightIcon data-icon="inline-end" aria-hidden />
          </Button>
        </div>
        {classes.length === 0 ? (
          <Card className="shadow-card relative overflow-hidden">
            <div aria-hidden className="bg-brand-soft pointer-events-none absolute inset-0" />
            <CardContent className="relative flex flex-col items-center gap-3 p-10 text-center">
              <span className="bg-brand text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-md">
                <SchoolIcon className="size-6" aria-hidden />
              </span>
              <p className="text-base font-semibold tracking-tight">No classes assigned yet</p>
              <p className="text-muted-foreground max-w-sm text-sm text-pretty">
                Your admin assigns classes to you — or head to classes to create and claim one.
              </p>
              <Button variant="outline" size="sm" render={<Link href="/teacher/classes" />} className="mt-1">
                Go to classes
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {classes.slice(0, 6).map((cls) => (
              <li
                key={cls.id}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 190px" }}
                className="min-w-0"
              >
                <Link
                  href={`/teacher/classes/${cls.id}`}
                  className="group focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Card className="shadow-card relative h-full gap-0 overflow-hidden py-0 transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lifted">
                    <div aria-hidden className="bg-brand h-1 w-full opacity-90" />
                    <CardHeader className="pt-4 pb-0">
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="bg-brand-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold tracking-tight"
                        >
                          {classMonogram(cls.name)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <CardTitle className="truncate text-[1.02rem]">{cls.name}</CardTitle>
                            <Badge variant="secondary" className="shrink-0">
                              {classLevelLabel(cls)}
                            </Badge>
                          </div>
                          <CardDescription className="mt-1 tabular-nums">
                            {cls.studentCount} student{cls.studentCount === 1 ? "" : "s"}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pt-3 pb-4">
                      <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
                        <TrophyIcon className="size-3.5" aria-hidden />
                        Open dashboard &amp; leaderboard
                        <ArrowUpRightIcon
                          aria-hidden
                          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent class exams */}
      {classExams.length > 0 && (
        <section aria-labelledby="teacher-recent-exams-heading">
          <Card className="shadow-card gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-4">
              <div>
                <CardTitle id="teacher-recent-exams-heading">Recent exams in your classes</CardTitle>
                <CardDescription>Jump into results and review.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" render={<Link href="/teacher/exams" />} className="shrink-0">
                View all
                <ArrowRightIcon data-icon="inline-end" aria-hidden />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {classExams.map(({ exam, class: cls }) => (
                  <li key={exam.id}>
                    <Link
                      href={`/teacher/exams/${exam.id}`}
                      className="hover:bg-accent/40 focus-visible:bg-accent/40 flex items-center gap-3 px-5 py-3.5 transition-colors focus-visible:outline-none sm:px-6"
                    >
                      <span
                        aria-hidden
                        className="bg-brand-soft text-primary hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex"
                      >
                        <GraduationCapIcon className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{exam.title}</span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {cls?.name ?? "Class"}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0 capitalize tabular-nums">
                        {exam.status}
                      </Badge>
                      <ArrowRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
