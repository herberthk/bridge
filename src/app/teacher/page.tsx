export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  SchoolIcon,
  SparklesIcon,
  TrophyIcon,
} from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getSchoolById } from "@/server/services/schools";
import { listClasses } from "@/server/services/classes";
import { listExams } from "@/server/services/exams";
import { KpiCard } from "@/components/features/dashboard/charts";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Teacher dashboard: the school in context, the classes they manage and
 * quick links into the exam workflow.
 */
export default async function TeacherDashboardPage() {
  const actor = await requireRole("teacher");

  const [classes, exams, school] = await Promise.all([
    listClasses(actor).catch(() => []),
    listExams(actor, 100).catch(() => ({ exams: [], partial: false, ordered: true })),
    actor.schoolId
      ? getSchoolById(actor.schoolId).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Class-scoped student counts + recent exams for the class cards.
  const studentCount = classes.reduce((n, c) => n + (c.studentCount ?? 0), 0);

  const classExams = classes.length
    ? await Promise.all(
        exams.exams
          .filter((e) => e.classId && classes.some((c) => c.id === e.classId))
          .slice(0, 5)
          .map(async (e) => ({
            exam: e,
            class: classes.find((c) => c.id === e.classId) ?? null,
          })),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* School header */}
      <div className="from-brand-soft/60 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-linear-to-r to-transparent p-6">
        <div className="flex items-center gap-4">
          <span className="bg-brand text-primary-foreground flex size-12 items-center justify-center rounded-2xl shadow-md">
            <SchoolIcon className="size-6" />
          </span>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              {school?.name ?? "Your school"}
              {school ? <VerifiedBadge status={school.verification} /> : null}
            </h1>
            <p className="text-muted-foreground text-sm">
              {school
                ? school.level === "primary"
                  ? "Primary school"
                  : "Secondary school"
                : "Loading…"}{" "}
              · {classes.length} class{classes.length === 1 ? "" : "es"} assigned to you
            </p>
          </div>
        </div>
        <Button render={<Link href="/teacher/generate" />} className="shadow-glow">
          <SparklesIcon data-icon="inline-start" />
          Generate exam
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="My classes" value={classes.length} hint="Assigned by your admin" />
        <KpiCard title="Students" value={studentCount} hint="Across your classes" />
        <KpiCard title="Exams" value={exams.exams.length} hint="In your school" />
        <div className="bg-brand shadow-glow relative overflow-hidden rounded-xl p-5 text-primary-foreground">
          <p className="text-sm opacity-80">School level</p>
          <p className="mt-1.5 text-3xl font-semibold">
            {school ? (school.level === "primary" ? "Primary" : "Secondary") : "—"}
          </p>
          <p className="mt-1 text-xs opacity-70">Single curriculum track</p>
        </div>
      </div>

      {/* My classes */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">My classes</h2>
          <Button variant="ghost" size="sm" render={<Link href="/teacher/classes" />}>
            View all
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
        {classes.length === 0 ? (
          <Card className="shadow-card">
            <CardContent className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
              <SchoolIcon className="text-muted-foreground/40 size-8" />
              No classes assigned to you yet. Your admin assigns classes — or you
              can create one.
              <Button variant="outline" size="sm" render={<Link href="/teacher/classes" />} className="mt-2">
                Go to classes
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {classes.slice(0, 6).map((cls) => (
              <Link key={cls.id} href={`/teacher/classes/${cls.id}`} className="group">
                <Card className="shadow-card h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-lifted">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{cls.name}</CardTitle>
                      <Badge variant="secondary">
                        {cls.level === "primary" ? "Primary" : cls.secondarySubLevel === "a_level" ? "A level" : "O level"}
                      </Badge>
                    </div>
                    <CardDescription>
                      {cls.studentCount} student{cls.studentCount === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <TrophyIcon className="size-3" />
                      Open dashboard &amp; leaderboard
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent class exams */}
      {classExams.length > 0 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>Recent exams in your classes</CardTitle>
            <CardDescription>Jump into results and review.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {classExams.map(({ exam, class: cls }) => (
                <Link
                  key={exam.id}
                  href={`/teacher/exams/${exam.id}`}
                  className="hover:bg-accent/40 flex items-center justify-between gap-3 px-6 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{exam.title}</p>
                    <p className="text-muted-foreground text-xs">{cls?.name ?? "Class"}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {exam.status}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
