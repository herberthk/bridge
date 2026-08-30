"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarClockIcon, ClipboardCheckIcon, FileStackIcon } from "lucide-react";

import { AssignExamDialog } from "@/components/features/admin/assign-exam-dialog";
import { reviewProgress } from "@/lib/exam/review";
import { SUBJECT_LABELS, type ExamStatus, type Subject } from "@/lib/constants";
import type { ExamDoc, UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT: Record<ExamStatus, "default" | "secondary" | "outline"> = {
  draft: "outline",
  scheduled: "default",
  active: "secondary",
  archived: "outline",
};

export function ExamLibrary({
  exams,
  students,
  retakeCounts = {},
}: {
  exams: SerializedWithId<ExamDoc>[];
  students: SerializedWithId<UserDoc>[];
  retakeCounts?: Record<string, number>;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exam library</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {exams.length} generated exam{exams.length === 1 ? "" : "s"} — assign
          them to students when ready.
        </p>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        {exams.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
              <FileStackIcon className="size-6" />
            </span>
            <p className="font-medium">No exams yet</p>
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              Generate your first AI exam — it takes about 20 seconds.
            </p>
            <Button variant="outline" size="sm" onClick={() => router.push("/admin/generate")}>
              Generate an exam
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exam</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Retakes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((e) => {
                // Legacy/imported docs may carry an unparseable createdAt —
                // fall back to “–” rather than letting format() throw.
                const created = parseDate(e.createdAt);
                const progress = reviewProgress(e.questions, e.review);
                // Only drafts are gated, so only drafts are flagged. Exams that
                // pre-date this screen are all non-draft or already assigned, and
                // badging them "needs review" would fault work already done.
                const needsReview = e.status === "draft" && !progress.complete;
                return (
                <TableRow key={e.id}>
                  <TableCell className="max-w-64">
                    <div className="flex flex-col">
                      <Link href={`/admin/exams/${e.id}`} className="truncate font-medium hover:underline">{e.title}</Link>
                      <span className="text-muted-foreground truncate text-xs">
                        {e.params.topic}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{SUBJECT_LABELS[e.params.subject as Subject] ?? e.params.subject}</TableCell>
                  <TableCell>
                    {e.params.level === "primary"
                      ? `P${e.params.classLevel}`
                      : `S${e.params.classLevel} · ${e.params.secondarySubLevel === "a_level" ? "A" : "O"}`}
                  </TableCell>
                  <TableCell className="tabular-nums">{e.questions.length}</TableCell>
                  <TableCell className="tabular-nums">{e.params.durationMinutes} min</TableCell>
                  <TableCell className="tabular-nums">
                    {retakeCounts[e.id] ? (
                      <Badge variant="secondary" className="tabular-nums">{retakeCounts[e.id]} retake{retakeCounts[e.id] !== 1 ? "s" : ""}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANT[e.status as ExamStatus] ?? "outline"}>
                        {e.status}
                      </Badge>
                      {needsReview && (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 tabular-nums text-amber-700 dark:text-amber-400"
                        >
                          {progress.approved}/{progress.total} reviewed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {created ? format(created, "d MMM yyyy") : "–"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {e.status === "draft" && (
                        <Button
                          size="sm"
                          variant={needsReview ? "default" : "ghost"}
                          render={<Link href={`/admin/exams/${e.id}/review`} />}
                        >
                          <ClipboardCheckIcon data-icon="inline-start" />
                          Review
                        </Button>
                      )}
                      {e.status !== "archived" && (
                        <AssignExamDialog exam={e} students={students} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <CalendarClockIcon className="size-3.5" />
        Scheduled exams unlock for students at their scheduled time.
      </p>
    </div>
  );
}
