"use client";

import { useActionState, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarClockIcon, FileStackIcon, SendIcon } from "lucide-react";

import { assignExamAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import { useActionToast } from "@/components/features/super/schools-manager";
import { SUBJECT_LABELS, type ExamStatus, type Subject } from "@/lib/constants";
import type { ExamDoc, UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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

function AssignDialog({ exam, students }: { exam: SerializedWithId<ExamDoc>; students: SerializedWithId<UserDoc>[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    assignExamAction,
    null,
  );
  // setSelected/setOpen are stable React setters, so this callback is stable
  // too — safe to pass straight to useActionToast without a ref.
  const closeAndReset = useCallback(() => {
    setOpen(false);
    setSelected([]);
  }, []);
  useActionToast(state, closeAndReset, "Exam assigned");

  const active = students.filter((s) => s.status === "active");
  // Flag students whose class doesn't match the exam — assigning a P4 exam to
  // a P7 student is possible but almost always a mistake.
  const matchesExamClass = (s: SerializedWithId<UserDoc>) =>
    s.level === exam.params.level && s.classLevel === exam.params.classLevel;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <SendIcon data-icon="inline-start" />
        Assign
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign “{exam.title}”</DialogTitle>
          <DialogDescription>
            Creates an attempt for each selected student. Optionally schedule
            it for a later date/time.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="examId" value={exam.id} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="studentIds" value={id} />
          ))}
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>
                Students ({selected.length} of {active.length} selected)
              </FieldLabel>
              <ScrollArea className="h-52 rounded-lg border">
                <div className="flex flex-col gap-1 p-3">
                  {active.length === 0 && (
                    <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                      No active students — add students first.
                    </p>
                  )}
                  {active.map((s) => (
                    <label
                      key={s.id}
                      className="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors"
                    >
                      <Checkbox
                        checked={selected.includes(s.id)}
                        onCheckedChange={(checked) =>
                          setSelected((prev) =>
                            checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                          )
                        }
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{s.displayName}</span>
                          {!matchesExamClass(s) && (
                            <Badge variant="outline" className="text-amber-600 shrink-0">
                              {s.level === "primary" ? `P${s.classLevel}` : `S${s.classLevel}`}
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {s.level === "primary" ? `P${s.classLevel}` : `S${s.classLevel}`} ·{" "}
                          {s.email}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </Field>
            <Field>
              <FieldLabel htmlFor="scheduledFor">Schedule for (optional)</FieldLabel>
              <Input id="scheduledFor" name="scheduledFor" type="datetime-local" />
              <FieldDescription>Leave empty to make it available now.</FieldDescription>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || selected.length === 0}>
                {pending ? "Assigning…" : `Assign to ${selected.length || "…"}`}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExamLibrary({
  exams,
  students,
}: {
  exams: SerializedWithId<ExamDoc>[];
  students: SerializedWithId<UserDoc>[];
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
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {exams.map((e) => {
                // Legacy/imported docs may carry an unparseable createdAt —
                // fall back to “–” rather than letting format() throw.
                const created = parseDate(e.createdAt);
                return (
                <TableRow key={e.id}>
                  <TableCell className="max-w-64">
                    <div className="flex flex-col">
                      <span className="truncate font-medium">{e.title}</span>
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
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[e.status as ExamStatus] ?? "outline"}>
                      {e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {created ? format(created, "d MMM yyyy") : "–"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {e.status !== "archived" && (
                        <AssignDialog exam={e} students={students} />
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
