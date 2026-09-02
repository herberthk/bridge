"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  BookOpenCheckIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";

import type { ClassDoc, ExamDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import type { ClassPerformanceStats, LeaderboardEntry } from "@/lib/leaderboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StudentsTable } from "@/components/features/admin/students-table";
import { LeaderboardView } from "@/components/features/school/leaderboard-view";
import type { ClassExamPerformance } from "@/server/services/leaderboard";

/** Serialized ExamDoc top-level timestamps arrive as ISO strings or null. */
function formatDeadline(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return null;
  return `Closes ${format(new Date(ms), "d MMM, HH:mm")}`;
}

/**
 * Class dashboard shared by school admins and teachers: roster, leaderboard,
 * per-exam performance and the shortcuts into exam generation/assignment.
 */
export function ClassDashboardView({
  cls,
  basePath,
  students,
  leaderboard,
  stats,
  examPerformance,
  classExams,
  canManage,
}: {
  cls: SerializedWithId<ClassDoc>;
  basePath: "/admin" | "/teacher";
  students: SerializedWithId<UserDoc>[];
  leaderboard: LeaderboardEntry[];
  stats: ClassPerformanceStats;
  examPerformance: ClassExamPerformance[];
  classExams: SerializedWithId<ExamDoc>[];
  canManage: boolean;
}) {
  const [tab, setTab] = useState("students");

  return (
    <div className="flex flex-col gap-6">
      {/* Class header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{cls.name}</h1>
            <Badge variant="secondary">
              {cls.level === "primary"
                ? "Primary"
                : cls.secondarySubLevel === "a_level"
                  ? "A level"
                  : "O level"}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3.5" />
              {students.length} students
            </span>
            <span className="inline-flex items-center gap-1">
              <BookOpenCheckIcon className="size-3.5" />
              {classExams.length} exam{classExams.length === 1 ? "" : "s"}
            </span>
            {stats.averagePercentage !== null && (
              <span className="inline-flex items-center gap-1">
                <TrophyIcon className="size-3.5" />
                {stats.averagePercentage}% average
              </span>
            )}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              render={
                <Link
                  href={`${basePath}/generate?level=${cls.level}&sublevel=${cls.secondarySubLevel ?? "o_level"}&classLevel=${cls.classLevel}&classId=${cls.id}&className=${encodeURIComponent(cls.name)}`}
                />
              }
            >
              <SparklesIcon data-icon="inline-start" />
              Generate exam
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="mt-4">
          <StudentsTable
            students={students}
            viewerRole={basePath === "/admin" ? "admin" : "teacher"}
            total={students.length}
            fixedClassId={cls.id}
          />
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
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
