"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckIcon, CopyIcon, UserRoundPlusIcon } from "lucide-react";
import { toast } from "sonner";

import { inviteTeacherAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { ClassDoc } from "@/types/firestore";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Invite a teacher by email. The invite link is emailed (when SMTP is
 * configured) and always shown here so the admin can share it directly.
 */
export function InviteTeacherDialog({
  classes,
}: {
  classes: SerializedWithId<ClassDoc>[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    inviteTeacherAction,
    null,
  );
  const inviteUrl = state?.ok ? state.inviteUrl : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); }} key={state?.ok ? "done" : "form"}>
      <DialogTrigger render={<Button className="shadow-glow" />}>
        <UserRoundPlusIcon data-icon="inline-start" />
        Invite teacher
      </DialogTrigger>
      <DialogContent>
        {state?.ok && inviteUrl ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite ready to share</DialogTitle>
              <DialogDescription>
                We&apos;ve emailed this link (if email is configured). It works
                once and expires in 7 days — share it with the teacher directly
                if it doesn&apos;t arrive.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted/50 flex items-center gap-2 rounded-lg border p-2">
              <code className="min-w-0 flex-1 truncate text-xs">{inviteUrl}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl);
                  toast.success("Invite link copied");
                }}
              >
                <CopyIcon data-icon="inline-start" />
                Copy
              </Button>
            </div>
            <DialogFooter>
              <Button
                type="button"
                render={<Link href="/admin/teachers" />}
                onClick={() => setOpen(false)}
              >
                <CheckIcon data-icon="inline-start" />
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite a teacher</DialogTitle>
              <DialogDescription>
                They&apos;ll set their own password via a secure invite link,
                then see your school in their dashboard with the classes you
                assign.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="invite-email">Teacher&apos;s email</FieldLabel>
                  <Input
                    id="invite-email"
                    name="email"
                    type="email"
                    required
                    placeholder="teacher@school.ac.ug"
                  />
                </Field>
                {classes.length > 0 && (
                  <Field>
                    <FieldLabel>Assign classes (optional)</FieldLabel>
                    <FieldDescription>
                      The teacher manages these classes as soon as they accept.
                    </FieldDescription>
                    <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
                      {classes.map((c) => (
                        <label
                          key={c.id}
                          className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            name="classIds"
                            value={c.id}
                            className="accent-indigo-600 size-4"
                          />
                          <span className="truncate">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating invite…" : "Send invite"}
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
