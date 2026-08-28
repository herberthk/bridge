"use client";

import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  ClipboardListIcon,
  ClockIcon,
  FileCheck2Icon,
  TimerIcon,
} from "lucide-react";

import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import type { StudentAttemptListItem } from "@/server/services/attempts";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export interface AttemptWithExam {
  /** Projected attempt (list fields only — answers are not sent to clients). */
  attempt: SerializedWithId<StudentAttemptListItem>;
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    questionCount: number;
  } | null;
}

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Ready", variant: "default" },
  in_progress: { label: "In progress", variant: "secondary" },
  submitted: { label: "Grading…", variant: "outline" },
  graded: { label: "Graded", variant: "secondary" },
  flagged: { label: "Under review", variant: "destructive" },
};

export function StudentExamsList({ items }: { items: AttemptWithExam[] }) {
  const upcoming = items.filter((i) =>
    i.attempt.status === "pending" || i.attempt.status === "in_progress",
  );
  const past = items.filter((i) =>
    i.attempt.status !== "pending" && i.attempt.status !== "in_progress",
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My exams</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {upcoming.length} to take · {past.length} completed
        </p>
      </div>

      {upcoming.length === 0 ? (
        <div className="shadow-card flex flex-col items-center gap-3 rounded-xl border bg-card p-12 text-center">
          <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
            <ClipboardListIcon className="size-6" />
          </span>
          <p className="font-medium">No exams waiting</p>
          <p className="text-muted-foreground max-w-sm text-sm text-pretty">
            When your teacher assigns an exam, it appears here with its
            schedule and duration.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {upcoming.map(({ attempt, exam }) => (
            <div
              key={attempt.id}
              className="group shadow-card gradient-border rounded-xl p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lifted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{exam?.title ?? "Exam"}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {exam ? SUBJECT_LABELS[exam.subject as Subject] ?? exam.subject : ""} ·{" "}
                    {exam?.questionCount ?? "–"} questions
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(attempt as unknown as { retakeOf?: string | null }).retakeOf && (
                    <Badge variant="outline" className="border-amber-500/20 text-amber-700">Retake</Badge>
                  )}
                  <Badge variant={STATUS_META[attempt.status]?.variant ?? "outline"}>
                    {STATUS_META[attempt.status]?.label ?? attempt.status}
                  </Badge>
                </div>
              </div>
              <div className="text-muted-foreground mt-3 flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <TimerIcon className="size-3.5" />
                  {exam?.durationMinutes ?? "–"} min
                </span>
                {attempt.scheduledFor && (
                  <span className="flex items-center gap-1">
                    <ClockIcon className="size-3.5" />
                    {format(parseDate(attempt.scheduledFor)!, "d MMM, HH:mm")}
                  </span>
                )}
              </div>
              {attempt.status === "pending" ? (
                <Button
                  className="shadow-glow mt-4 w-full"
                  nativeButton={false}
                  render={<Link href={`/exam/${attempt.id}`} />}
                >
                  Start exam
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  nativeButton={false}
                  render={<Link href={`/exam/${attempt.id}`} />}
                >
                  Continue exam
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-medium">Completed</h2>
          <div className="shadow-card flex flex-col divide-y rounded-xl border bg-card">
            {past.map(({ attempt, exam }) => (
              <Link
                key={attempt.id}
                href={`/student/results/${attempt.id}`}
                className="hover:bg-accent/40 flex items-center gap-4 p-4 transition-colors"
              >
                <FileCheck2Icon className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{exam?.title ?? "Exam"}</p>
                    {(attempt as unknown as { retakeOf?: string | null }).retakeOf && (
                      <Badge variant="outline" className="border-amber-500/20 text-amber-700 text-[10px] px-1.5 py-0">Retake</Badge>
                    )}
                    {exam && (
                      <Link href={`/student/exams/${exam.id}`} className="text-primary text-[11px] hover:underline hidden sm:inline" onClick={(e) => e.stopPropagation()}>history</Link>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {attempt.submittedAt
                      ? format(parseDate(attempt.submittedAt)!, "d MMM yyyy, HH:mm")
                      : "—"}
                  </p>
                </div>
                {attempt.score ? (
                  <div className="flex w-32 flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Score</span>
                      <span className="font-semibold tabular-nums">
                        {attempt.score.percentage}%
                      </span>
                    </div>
                    <Progress
                      value={attempt.score.percentage}
                      className="bg-muted h-1.5"
                    />
                  </div>
                ) : (
                  <Badge variant={STATUS_META[attempt.status]?.variant ?? "outline"}>
                    {STATUS_META[attempt.status]?.label ?? attempt.status}
                  </Badge>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      <Skeleton className="hidden" />
    </div>
  );
}
