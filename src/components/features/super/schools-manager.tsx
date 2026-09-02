"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  BadgeCheckIcon,
  Building2Icon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { setSchoolVerificationAction } from "@/app/super/actions";
import { VerifiedBadge } from "@/components/features/school/verified-badge";

import {
  createSchoolAction,
  createStandaloneAdminAction,
} from "@/app/super/actions";
import type { ActionState } from "@/app/admin/actions";
import type { SchoolDoc, UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function useActionToast(
  state: ActionState | { ok: boolean; error?: string } | null,
  onOk?: () => void,
  successMessage?: string,
) {
  // The effect depends only on `state`, so each distinct action result is
  // handled exactly once. Refs (synced in their own effect, never during
  // render) keep the latest callbacks without re-triggering it.
  const onOkRef = useRef(onOk);
  const messageRef = useRef(successMessage);

  useEffect(() => {
    onOkRef.current = onOk;
    messageRef.current = successMessage;
  }, [onOk, successMessage]);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(messageRef.current ?? "Done.");
      onOkRef.current?.();
    } else {
      toast.error(state.error ?? "Something went wrong.");
    }
  }, [state]);
}

/** Password input with reveal toggle — temp passwords are shared out-of-band. */
export function TempPasswordField({ id, name }: { id: string; name: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        required
        autoComplete="new-password"
        placeholder="10+ chars, mixed case, number"
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

function CreateSchoolDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createSchoolAction,
    null,
  );
  useActionToast(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="shadow-glow" />}>
        <PlusIcon data-icon="inline-start" />
        New school
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a school</DialogTitle>
          <DialogDescription>
            Adds the school plus its owner-admin account, and initializes a
            token wallet you can top up.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} key={state?.ok ? "reset" : "form"}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="schoolName">School name</FieldLabel>
              <Input id="schoolName" name="schoolName" required placeholder="e.g. St. Mary's College Kisubi" />
            </Field>
            <Field>
              <FieldLabel>School level</FieldLabel>
              <FieldDescription>
                A school is primary OR secondary — this sets its standard classes (P1-P7 or S1-S6).
              </FieldDescription>
              <div className="grid grid-cols-2 gap-2">
                <label className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input type="radio" name="level" value="primary" className="accent-indigo-600" />
                  Primary (P1-P7)
                </label>
                <label className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input type="radio" name="level" value="secondary" defaultChecked className="accent-indigo-600" />
                  Secondary (S1-S6)
                </label>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="ownerName">Owner (principal) name</FieldLabel>
              <Input id="ownerName" name="ownerName" required placeholder="e.g. Jane Okello" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ownerEmail">Owner email</FieldLabel>
              <Input id="ownerEmail" name="ownerEmail" type="email" required placeholder="principal@school.ac.ug" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ownerPassword">Temporary password</FieldLabel>
              <TempPasswordField id="ownerPassword" name="ownerPassword" />
              <FieldDescription>Share it securely — they should change it after first sign-in.</FieldDescription>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create school"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateStandaloneAdminDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createStandaloneAdminAction,
    null,
  );
  useActionToast(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <UserRoundPlusIcon data-icon="inline-start" />
        Standalone admin
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a standalone admin</DialogTitle>
          <DialogDescription>
            For parents and tutors who manage their own children outside any
            school. Billing runs on their personal wallet.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} key={state?.ok ? "reset" : "form"}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="displayName">Full name</FieldLabel>
              <Input id="displayName" name="displayName" required placeholder="e.g. Daniel Mugisha" />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" required placeholder="parent@email.com" />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Temporary password</FieldLabel>
              <TempPasswordField id="password" name="password" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create admin"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SchoolsManager({
  schools,
  standaloneAdmins,
  totals,
}: {
  schools: SerializedWithId<SchoolDoc>[];
  standaloneAdmins: SerializedWithId<UserDoc>[];
  totals: {
    schools: number;
    schoolsTruncated: boolean;
    standaloneAdmins: number;
    adminsTruncated: boolean;
  };
}) {
  const totalStudents = schools.reduce((n, s) => n + (s.studentCount ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schools &amp; admins</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totals.schools} school{totals.schools === 1 ? "" : "s"} ·{" "}
            {totalStudents} {totals.schoolsTruncated ? "students in displayed schools" : "students"} · {totals.standaloneAdmins} standalone admin
            {totals.standaloneAdmins === 1 ? "" : "s"}
          </p>
          {(totals.schoolsTruncated || totals.adminsTruncated) && (
            <p className="text-muted-foreground mt-1 text-xs">
              Showing the most recent {schools.length} schools and{" "}
              {standaloneAdmins.length} admins.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <CreateStandaloneAdminDialog />
          <CreateSchoolDialog />
        </div>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        {schools.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
              <Building2Icon className="size-6" />
            </span>
            <p className="font-medium">No schools yet</p>
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              Create the first school — its owner becomes the admin who manages
              teachers and students.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {s.level ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <VerifiedBadge status={s.verification} />
                  </TableCell>
                  <TableCell>{(s.adminCount ?? 0) + (s.teacherCount ?? 0)}</TableCell>
                  <TableCell>{s.studentCount}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {s.createdAt ? format(parseDate(s.createdAt)!, "d MMM yyyy") : "–"}
                  </TableCell>
                  <TableCell className="text-right">
                    <VerifyAction schoolId={s.id} verified={s.verification === "verified"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Standalone admins</CardTitle>
          <CardDescription>
            Parents and tutors billing on personal wallets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {standaloneAdmins.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              None yet — create one for a parent or tutor.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {standaloneAdmins.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-2.5"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{a.displayName}</span>
                    <span className="text-muted-foreground text-xs">{a.email}</span>
                  </div>
                  <Badge variant={a.status === "active" ? "secondary" : "destructive"}>
                    {a.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


/** Grant or revoke a school's blue tick. */
function VerifyAction({
  schoolId,
  verified,
}: {
  schoolId: string;
  verified: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    setSchoolVerificationAction,
    null,
  );
  useActionToast(state, undefined, verified ? "Verification revoked" : "School verified");

  return (
    <form action={formAction}>
      <input type="hidden" name="schoolId" value={schoolId} />
      <input type="hidden" name="status" value={verified ? "unverified" : "verified"} />
      <Button
        type="submit"
        variant={verified ? "outline" : "default"}
        size="sm"
        disabled={pending}
        title={
          verified
            ? "Revoke the blue tick"
            : "Verify this school (requires their registration details)"
        }
      >
        <BadgeCheckIcon data-icon="inline-start" />
        {pending ? "Saving…" : verified ? "Unverify" : "Verify"}
      </Button>
    </form>
  );
}
