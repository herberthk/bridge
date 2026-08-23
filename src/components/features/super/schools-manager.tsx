"use client";

import { useActionState, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Building2Icon, PlusIcon, UserRoundPlusIcon } from "lucide-react";

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

function useActionToast(state: ActionState | null, onOk?: () => void) {
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("Done.");
      onOk?.();
    } else {
      toast.error(state.error);
    }
  }, [state, onOk]);
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
              <FieldLabel htmlFor="ownerName">Owner (principal) name</FieldLabel>
              <Input id="ownerName" name="ownerName" required placeholder="e.g. Jane Okello" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ownerEmail">Owner email</FieldLabel>
              <Input id="ownerEmail" name="ownerEmail" type="email" required placeholder="principal@school.ac.ug" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ownerPassword">Temporary password</FieldLabel>
              <Input id="ownerPassword" name="ownerPassword" type="text" required placeholder="10+ chars, mixed case, number" />
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
              <Input id="password" name="password" type="text" required placeholder="10+ chars, mixed case, number" />
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
}: {
  schools: SerializedWithId<SchoolDoc>[];
  standaloneAdmins: SerializedWithId<UserDoc>[];
}) {
  const totalStudents = schools.reduce((n, s) => n + (s.studentCount ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schools &amp; admins</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {schools.length} school{schools.length === 1 ? "" : "s"} ·{" "}
            {totalStudents} students · {standaloneAdmins.length} standalone admin
            {standaloneAdmins.length === 1 ? "" : "s"}
          </p>
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
                <TableHead>Admins</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.adminCount}</TableCell>
                  <TableCell>{s.studentCount}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                  {s.createdAt.toString()}
                    {/* {s.createdAt ? format(parseDate(s.createdAt)!, "d MMM yyyy") : "–"} */}
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
