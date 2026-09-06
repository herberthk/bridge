"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  BookOpenCheckIcon,
  GraduationCapIcon,
  SchoolIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import type { ClassDoc, ExamDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import type { ClassPerformanceStats, LeaderboardEntry } from "@/lib/leaderboard";
import type { SchoolVerificationStatus } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { StudentsTable } from "@/components/features/admin/students-table";
import { LeaderboardView } from "@/components/features/school/leaderboard-view";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { classLevelLabel, classMonogram } from "@/lib/class-display";
import type { ClassExamPerformance } from "@/server/services/leaderboard";

/** Serialized ExamDoc top-level timestamps arrive as ISO strings or null. */
function formatDeadline(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return null;
  return `Closes ${format(new Date(ms), "d MMM, HH:mm")}`;
}

function yearLabel(cls: Pick<ClassDoc, "level" | "classLevel">): string {
  return cls.level === "primary" ? `P${cls.classLevel}` : `S${cls.classLevel}`;
}

function generateExamHref(basePath: "/admin" | "/teacher", cls: { id: string } & Pick<ClassDoc, "level" | "secondarySubLevel" | "classLevel" | "name">): string {
  const params = new URLSearchParams({
    level: cls.level,
    sublevel: cls.secondarySubLevel ?? "o_level",
    classLevel: String(cls.classLevel),
    classId: cls.id,
    className: cls.name,
  });
  return `${basePath}/generate?${params.toString()}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "–").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

/**
 * Class dashboard shared by school admins and teachers: premium hero header
 * (breadcrumb, monogram, KPIs, teacher chips, actions), roster, leaderboard,
 * per-exam performance and the shortcuts into exam generation/assignment.
 *
 * Single source of truth for the class header — both `/admin` and `/teacher`
 * detail pages render this, so header changes land in one place. Role-specific
 * copy (workspace label, parent crumb) derives from `basePath`.
 */
export function ClassDashboardView({
  cls,
  basePath,
  students,
  studentCount,
  leaderboard,
  stats,
  examPerformance,
  classExams,
  canManage,
  schoolName = null,
  schoolVerification = null,
  teacherNames = [],
  teachersUnavailable = false,
  rosterTruncated = false,
  cachedStudentCount = null,
  degraded = [],
  examsPartial = false,
}: {
  cls: SerializedWithId<ClassDoc>;
  basePath: "/admin" | "/teacher";
  students: SerializedWithId<UserDoc>[];
  /** Exact headcount — the listed slice is capped, so totals never derive from its length. */
  studentCount: number;
  leaderboard: LeaderboardEntry[];
  stats: ClassPerformanceStats;
  examPerformance: ClassExamPerformance[];
  classExams: SerializedWithId<ExamDoc>[];
  canManage: boolean;
  /** Denormalized school name for the hero (null while unavailable). */
  schoolName?: string | null;
  /** School blue-tick status for the hero badge. */
  schoolVerification?: SchoolVerificationStatus | null;
  /** Display names of teachers assigned to this class. */
  teacherNames?: string[];
  /** Staff lookup failed — render teacher details as unavailable, never as unassigned. */
  teachersUnavailable?: boolean;
  /** Roster list hit its cap — leaderboard rates cover the listed slice only. */
  rosterTruncated?: boolean;
  /** Denormalized `classes.studentCount` — shows a drift alert when it disagrees with the live roster. */
  cachedStudentCount?: number | null;
  /** Widget scopes that fell back (logged server-side) — rendered as one banner, never silent. */
  degraded?: string[];
  /** The class-exams scan hit its batch ceiling — the list may miss older exams. */
  examsPartial?: boolean;
}) {
  const [tab, setTab] = useState("students");
  const isTeacher = basePath === "/teacher";
  const workspaceLabel = isTeacher ? "Teacher workspace" : "Admin workspace";
  const parentLabel = isTeacher ? "My classes" : "Classes";
  const drift = cachedStudentCount !== null && cachedStudentCount !== studentCount;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link href={`${basePath}/classes`} />}
              className="text-muted-foreground hover:text-foreground"
            >
              {parentLabel}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="font-semibold">{cls.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Premium hero — CSS-only backdrop (no client JS beyond tabs below). */}
      <section className="bg-mesh relative overflow-hidden rounded-2xl border">
        <div aria-hidden className="bg-brand-soft pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-start justify-between gap-5 p-6 sm:p-7">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <span
              aria-hidden
              className="bg-brand text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold tracking-tight shadow-md"
            >
              {classMonogram(cls.name)}
            </span>
            <div className="min-w-0 max-w-2xl">
              <Badge variant="secondary" className="mb-2.5">
                {workspaceLabel}
                {schoolName ? ` · ${schoolName}` : ""}
              </Badge>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-balance sm:text-[1.7rem]">
                {cls.name}
                {schoolVerification ? <VerifiedBadge status={schoolVerification} /> : null}
              </h1>
              <p className="text-muted-foreground mt-1.5 max-w-xl text-sm text-pretty">
                {classLevelLabel(cls)} · Year {yearLabel(cls)}
                {teacherNames.length > 0
                  ? ` · Taught by ${teacherNames.join(", ")}`
                  : teachersUnavailable
                    ? " · Teacher details unavailable"
                    : " · No teacher assigned yet"}
              </p>
              <dl className="mt-4 flex flex-wrap gap-2.5 text-sm">
                <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2">
                  <UsersIcon className="text-primary size-4" aria-hidden />
                  <dt className="text-muted-foreground">Students</dt>
                  <dd className="font-semibold tabular-nums">{studentCount}</dd>
                </div>
                <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2">
                  <GraduationCapIcon className="text-primary size-4" aria-hidden />
                  <dt className="text-muted-foreground">Year</dt>
                  <dd className="font-semibold tabular-nums">{yearLabel(cls)}</dd>
                </div>
                <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2">
                  <BookOpenCheckIcon className="text-primary size-4" aria-hidden />
                  <dt className="text-muted-foreground">Curriculum</dt>
                  <dd className="font-semibold">{classLevelLabel(cls)}</dd>
                </div>
                <div className="glass hidden items-center gap-2 rounded-xl px-3.5 py-2 sm:flex">
                  <SchoolIcon className="text-primary size-4" aria-hidden />
                  <dt className="text-muted-foreground">School</dt>
                  <dd className="max-w-44 truncate font-semibold">{schoolName ?? "—"}</dd>
                </div>
              </dl>
              {teacherNames.length > 1 && (
                <ul aria-label="Assigned teachers" className="mt-3 flex flex-wrap gap-1.5">
                  {teacherNames.map((name) => (
                    <li
                      key={name}
                      className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                    >
                      <span
                        aria-hidden
                        className="bg-primary/15 text-primary flex size-5 items-center justify-center rounded-full text-[10px] font-bold"
                      >
                        {initials(name)}
                      </span>
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" render={<Link href={`${basePath}/classes`} />}>
              All classes
            </Button>
            {canManage && (
              <Button render={<Link href={generateExamHref(basePath, cls)} />}>
                <SparklesIcon data-icon="inline-start" />
                Generate exam
              </Button>
            )}
          </div>
        </div>
      </section>

      {drift && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>
            Headcount out of sync — {studentCount} enrolled, {cachedStudentCount} cached
          </AlertTitle>
          <AlertDescription>
            Class cards cache their totals and catch up shortly. The roster below is the
            source of truth.
          </AlertDescription>
        </Alert>
      )}

      {degraded.length > 0 && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle>Some sections couldn&apos;t load</AlertTitle>
          <AlertDescription>
            {degraded.join(" · ")} unavailable — please retry shortly. The student roster is
            unaffected.
          </AlertDescription>
        </Alert>
      )}

      {examsPartial && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 shadow-xs dark:text-amber-300">
          <p className="font-medium">The exams list for this class may be incomplete</p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="students">Students ({studentCount})</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="mt-4">
          <StudentsTable
            students={students}
            viewerRole={isTeacher ? "teacher" : "admin"}
            total={studentCount}
            fixedClassId={cls.id}
            fixedClassName={cls.name}
          />
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          {rosterTruncated && (
            <p className="text-muted-foreground mb-3 text-xs">
              Large class — ranks and averages cover the newest {students.length} listed
              students.
            </p>
          )}
          <LeaderboardView entries={leaderboard} stats={stats} />
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <div className="flex flex-col gap-4">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle>Per-exam performance</CardTitle>
                <CardDescription>
                  Average, highest and lowest scores for every exam this class has taken.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {examPerformance.length === 0 ? (
                  <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
                    No attempts yet — generate an exam and invite the class.
                  </div>
                ) : (
                  <div className="divide-y">
                    {examPerformance.map((e) => (
                      <div
                        key={e.examId}
                        className="hover:bg-accent/40 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5"
                      >
                        <Link
                          href={`${basePath}/exams/${e.examId}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {e.title}
                        </Link>
                        <div className="text-muted-foreground flex items-center gap-4 text-xs tabular-nums">
                          <span>{e.gradedCount} graded</span>
                          <span className="text-foreground text-sm font-semibold">
                            {e.averagePercentage === null ? "—" : `${e.averagePercentage}%`} avg
                          </span>
                          <span>
                            {e.lowestPercentage === null ? "—" : `${e.lowestPercentage}%`} –{" "}
                            {e.highestPercentage === null ? "—" : `${e.highestPercentage}%`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {classExams.length > 0 && (
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle>Exams for this class</CardTitle>
                  <CardDescription>Deadlines and status at a glance.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {classExams.slice(0, 8).map((exam) => {
                      const deadline = formatDeadline(
                        exam.expiresAt as unknown as string | null | undefined,
                      );
                      return (
                        <div
                          key={exam.id}
                          className="hover:bg-accent/40 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5"
                        >
                          <Link
                            href={`${basePath}/exams/${exam.id}`}
                            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                          >
                            {exam.title}
                          </Link>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">
                              {exam.status}
                            </Badge>
                            {deadline && (
                              <span className="text-muted-foreground text-xs">{deadline}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
