"use client";

import Link from "next/link";
import { useActionState, useCallback, useMemo, useState } from "react";
import { ClipboardCheckIcon, SendIcon, TriangleAlertIcon } from "lucide-react";

import { assignExamAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import { useActionToast } from "@/components/features/super/schools-manager";
import { reviewProgress } from "@/lib/exam/review";
import type { ExamDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
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

/**
 * Assign an exam to students — the one copy, shared by the library table and the
 * review screen.
 *
 * It used to be private to `exam-library.tsx`. The review screen needs the same
 * dialog with the same review gate, and two copies of a permission check is one
 * copy too many: the review screen's gate is the one that matters, and it is the
 * one a second implementation would drift from.
 */
export function AssignExamDialog({
  exam,
  students,
  size = "sm",
  variant = "outline",
  label = "Assign",
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  exam: SerializedWithId<ExamDoc>;
  students: SerializedWithId<UserDoc>[];
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "secondary";
  label?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const [selected, setSelected] = useState<string[]>([]);
  /** Second click on the override. Reset with the dialog, deliberately. */
  const [acknowledged, setAcknowledged] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    assignExamAction,
    null,
  );
  // setSelected/setOpen are stable React setters, so this callback is stable
  // too — safe to pass straight to useActionToast without a ref.
  const closeAndReset = useCallback(() => {
    setOpen(false);
    setSelected([]);
    setAcknowledged(false);
  }, [setOpen]);
  useActionToast(state, closeAndReset, "Exam assigned");

  const active = useMemo(() => students.filter((s) => s.status === "active"), [students]);
  // Flag students whose class doesn't match the exam — assigning a P4 exam to
  // a P7 student is possible but almost always a mistake.
  const matchesExamClass = (s: SerializedWithId<UserDoc>) =>
    s.level === exam.params.level && s.classLevel === exam.params.classLevel;

  // Mirrors `isAssignGated` on the server, which is the authority: this only
  // decides what the dialog shows. A stale client cannot assign past the gate.
  const progress = useMemo(
    () => reviewProgress(exam.questions, exam.review),
    [exam.questions, exam.review],
  );
  const gated = exam.status === "draft" && !progress.complete;
  const blocked = gated && !acknowledged;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAcknowledged(false);
      }}
    >
      <DialogTrigger render={<Button size={size} variant={variant} className={className} />}>
        <SendIcon data-icon="inline-start" />
        {label}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign “{exam.title}”</DialogTitle>
          <DialogDescription>
            Creates an attempt for each selected student. Optionally schedule it for a
            later date/time.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <input type="hidden" name="examId" value={exam.id} />
          {selected.map((id) => (
            <input key={id} type="hidden" name="studentIds" value={id} />
          ))}
          {acknowledged && (
            <input type="hidden" name="acknowledgeUnreviewed" value="true" />
          )}
          <div className="flex flex-col gap-4">
            {gated && (
              <div className="border-amber-500/30 bg-amber-500/10 flex gap-3 rounded-lg border p-3">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="flex min-w-0 flex-col gap-2 text-sm">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {progress.pendingIds.length} question
                    {progress.pendingIds.length === 1 ? "" : "s"} not yet reviewed
                  </p>
                  <p className="text-muted-foreground text-xs text-pretty">
                    {acknowledged
                      ? "You’re assigning this exam with unreviewed questions. This is recorded on the exam."
                      : "Read them through before students see them — or assign anyway and it will be recorded on the exam."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      render={<Link href={`/admin/exams/${exam.id}/review`} />}
                    >
                      <ClipboardCheckIcon data-icon="inline-start" />
                      Review questions
                    </Button>
                    {!acknowledged && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-amber-700 dark:text-amber-400"
                        onClick={() => setAcknowledged(true)}
                      >
                        Assign anyway
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
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
              <FieldLabel htmlFor={`scheduledFor-${exam.id}`}>
                Schedule for (optional)
              </FieldLabel>
              <Input
                id={`scheduledFor-${exam.id}`}
                name="scheduledFor"
                type="datetime-local"
              />
              <FieldDescription>Leave empty to make it available now.</FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setAcknowledged(false);
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || blocked || selected.length === 0}>
                {pending
                  ? "Assigning…"
                  : blocked
                    ? "Review required"
                    : `Assign to ${selected.length || "…"}`}
              </Button>
            </DialogFooter>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
