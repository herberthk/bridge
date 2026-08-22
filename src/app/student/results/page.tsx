export const dynamic = "force-dynamic";

import Link from "next/link";
import { format } from "date-fns";
import { ArrowRightIcon, LineChartIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { listStudentAttempts } from "@/server/services/attempts";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export const metadata = { title: "Results" };

export default async function StudentResultsPage() {
  const actor = await requireRole("student");
  let items: Awaited<ReturnType<typeof listStudentAttempts>> = [];
  try {
    items = await listStudentAttempts(actor);
  } catch (err) {
    console.error("[student/results] load failed", err);
  }
  const graded = items.filter((i) => i.attempt.status === "graded" || i.attempt.status === "flagged");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your graded exams with scores and AI feedback.
        </p>
      </div>

      {graded.length === 0 ? (
        <div className="shadow-card flex flex-col items-center gap-3 rounded-xl border bg-card p-12 text-center">
          <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
            <LineChartIcon className="size-6" />
          </span>
          <p className="font-medium">No results yet</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Take an exam and your graded results will appear here.
          </p>
        </div>
      ) : (
        <div className="shadow-card flex flex-col divide-y rounded-xl border bg-card">
          {graded.map(({ attempt, exam }) => (
            <Link
              key={attempt.id}
              href={`/student/results/${attempt.id}`}
              className="hover:bg-accent/40 flex items-center gap-4 p-4 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{exam?.title ?? "Exam"}</p>
                <p className="text-muted-foreground text-xs">
                  {attempt.gradedAt
                    ? format(attempt.gradedAt.toDate(), "d MMM yyyy, HH:mm")
                    : attempt.status === "flagged"
                      ? "Under review"
                      : "Grading…"}
                </p>
              </div>
              {attempt.score ? (
                <div className="flex w-36 flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {attempt.score.earned}/{attempt.score.possible}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {attempt.score.percentage}%
                    </span>
                  </div>
                  <Progress value={attempt.score.percentage} className="bg-muted h-1.5" />
                </div>
              ) : (
                <Badge variant={attempt.status === "flagged" ? "destructive" : "outline"}>
                  {attempt.status === "flagged" ? "Under review" : "Grading…"}
                </Badge>
              )}
              <ArrowRightIcon className="text-muted-foreground size-4" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
