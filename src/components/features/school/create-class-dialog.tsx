"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";

import { createClassesAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import { classLabel, standardClassLevelsForLevel, type SchoolLevel } from "@/lib/constants";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useActionToast } from "@/components/features/super/schools-manager";

/**
 * Create missing standard classes for the school. Staff pick from the
 * canonical set for the school's level — P1–P7 or S1–S6 — so class names stay
 * consistent across the platform.
 */
export function CreateClassDialog({
  schoolLevel,
  existingClassLevels,
  triggerLabel = "New class",
}: {
  schoolLevel: SchoolLevel;
  existingClassLevels: number[];
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createClassesAction,
    null,
  );
  useActionToast(state, () => setOpen(false), "Classes created");

  const existing = new Set(existingClassLevels);
  const available = standardClassLevelsForLevel(schoolLevel).filter((n) => !existing.has(n));
  const [selected, setSelected] = useState<number[]>([]);

  const toggle = (n: number) =>
    setSelected((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="shadow-glow" />}>
        <PlusIcon data-icon="inline-start" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create classes</DialogTitle>
          <DialogDescription>
            {schoolLevel === "primary"
              ? "Standard primary classes are Primary 1 – Primary 7."
              : "Secondary classes are Senior 1 – 4 (O level) and Senior 5 – 6 (A level)."}
            {" "}Only classes that don&apos;t exist yet are listed.
          </DialogDescription>
        </DialogHeader>
        {available.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Every standard class for this school level already exists. 🎉
          </p>
        ) : (
          <form action={formAction} key={state?.ok ? "reset" : "form"}>
            <FieldGroup>
              <Field>
                <FieldLabel>Select classes to create</FieldLabel>
                <FieldDescription>
                  {selected.length === 0
                    ? "Pick one or more classes."
                    : `${selected.length} class${selected.length === 1 ? "" : "es"} selected`}
                </FieldDescription>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {available.map((n) => {
                    const active = selected.includes(n);
                    return (
                      <button
                        type="button"
                        key={n}
                        onClick={() => toggle(n)}
                        aria-pressed={active}
                        className={
                          active
                            ? "border-primary bg-primary/10 text-primary ring-primary/30 rounded-lg border px-3 py-2 text-sm font-medium ring-2 transition-colors"
                            : "hover:bg-accent/60 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                        }
                      >
                        {classLabel(schoolLevel, n)}
                      </button>
                    );
                  })}
                </div>
                {selected.map((n) => (
                  <input key={n} type="hidden" name="classLevels" value={n} />
                ))}
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || selected.length === 0}>
                  {pending
                    ? "Creating…"
                    : `Create ${selected.length || ""} class${selected.length === 1 ? "" : "es"}`}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
