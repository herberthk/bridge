"use client";

import { useActionState, useState } from "react";
import { ClipboardListIcon } from "lucide-react";

import { assignTeacherClassesAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { ClassDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { useActionToast } from "@/components/features/super/schools-manager";

/** Admin sets which classes a teacher manages (replaces the current set). */
export function AssignClassesDialog({
  teacher,
  classes,
}: {
  teacher: SerializedWithId<UserDoc>;
  classes: SerializedWithId<ClassDoc>[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    assignTeacherClassesAction,
    null,
  );
  useActionToast(state, () => setOpen(false), "Classes assigned");
  const assigned = new Set(teacher.assignedClassIds ?? []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ClipboardListIcon data-icon="inline-start" />
        Assign classes
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Classes for {teacher.displayName}</DialogTitle>
          <DialogDescription>
            Tick every class this teacher manages. Classes they generate exams
            for are limited to this set.
          </DialogDescription>
        </DialogHeader>
        {classes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No classes yet — create classes first.
          </p>
        ) : (
          <form action={formAction}>
            <FieldGroup>
              <input type="hidden" name="teacherId" value={teacher.id} />
              <Field>
                <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
                  {classes.map((c) => (
                    <label
                      key={c.id}
                      className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="classIds"
                        value={c.id}
                        defaultChecked={assigned.has(c.id)}
                        className="accent-indigo-600 size-4"
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save assignment"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
