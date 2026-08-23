"use client";

import { useActionState, useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  BanIcon,
  CircleCheckIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlusIcon,
  UserRoundPlusIcon,
} from "lucide-react";

import {
  createStudentAction,
  setUserStatusAction,
  type ActionState,
} from "@/app/admin/actions";
import { classLevelOptions } from "@/lib/schemas/users";
import type { Role, UserStatus } from "@/lib/constants";
import type { UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STATUS_BADGE: Record<
  UserStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  active: { label: "Active", variant: "default" },
  suspended: { label: "Suspended", variant: "outline" },
  banned: { label: "Banned", variant: "destructive" },
};

function CreateStudentDialog() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<"primary" | "secondary">("secondary");
  const [subLevel, setSubLevel] = useState<"o_level" | "a_level">("o_level");
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createStudentAction,
    null,
  );
  const [handled, setHandled] = useState<ActionState | null>(null);

  // React render-phase state adjustment: react to each new action result once.
  if (state && state !== handled) {
    setHandled(state);
    if (state.ok) {
      setOpen(false);
      toast.success("Student created", {
        description: "Share the email + temporary password with the student.",
      });
    } else {
      toast.error(state.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="shadow-glow" />}>
        <PlusIcon data-icon="inline-start" />
        Add student
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a student</DialogTitle>
          <DialogDescription>
            Creates the account instantly. Share the temporary password — the
            student should change it after first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} key={state?.ok ? "reset" : "form"}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="displayName">Full name</FieldLabel>
              <Input
                id="displayName"
                name="displayName"
                required
                placeholder="e.g. Aisha Nakato"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="student@email.com"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Temporary password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="text"
                required
                placeholder="10+ chars, mixed case, number"
              />
              <FieldDescription>
                At least 10 characters with upper/lowercase and a number.
              </FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="level">Level</FieldLabel>
                <Select
                  name="level"
                  value={level}
                  onValueChange={(v) => setLevel(v as "primary" | "secondary")}
                >
                  <SelectTrigger id="level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary</SelectItem>
                    <SelectItem value="secondary">Secondary</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="classLevel">Class</FieldLabel>
                <Select
                  name="classLevel"
                  defaultValue={subLevel === "a_level" ? "5" : "2"}
                  key={`${level}-${subLevel}`}
                >
                  <SelectTrigger id="classLevel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {classLevelOptions(level, subLevel).map((opt) => (
                      <SelectItem key={opt.value} value={String(opt.value)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {level === "secondary" && (
              <Field>
                <FieldLabel>Secondary sub-level</FieldLabel>
                <input type="hidden" name="secondarySubLevel" value={subLevel} />
                <ToggleGroup
                  value={[subLevel]}
                  onValueChange={(v: readonly string[]) => {
                    const next = v[0] as "o_level" | "a_level" | undefined;
                    if (next) setSubLevel(next);
                  }}
                  className="flex"
                >
                  <ToggleGroupItem value="o_level" className="flex-1">
                    O Level (S1–S4)
                  </ToggleGroupItem>
                  <ToggleGroupItem value="a_level" className="flex-1">
                    A Level (S5–S6)
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create student"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StudentRowActions({ student }: { student: SerializedWithId<UserDoc> }) {
  const [banOpen, setBanOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    setUserStatusAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Student updated.");
    else toast.error(state.error);
  }, [state]);

  const submit = (
    status: UserStatus,
    extra?: { reason?: string; suspendedUntil?: string },
  ) => {
    const fd = new FormData();
    fd.set("userId", student.id);
    fd.set("status", status);
    if (extra?.reason) fd.set("reason", extra.reason);
    if (extra?.suspendedUntil) fd.set("suspendedUntil", extra.suspendedUntil);
    formAction(fd);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <MoreHorizontalIcon />
          <span className="sr-only">Actions for {student.displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          {student.status !== "active" && (
            <DropdownMenuItem onClick={() => submit("active")}>
              <CircleCheckIcon data-icon="inline-start" />
              Reactivate
            </DropdownMenuItem>
          )}
          {student.status === "active" && (
            <DropdownMenuItem
              onClick={() =>
                submit("suspended", {
                  suspendedUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
                })
              }
            >
              <PauseIcon data-icon="inline-start" />
              Suspend 7 days
            </DropdownMenuItem>
          )}
          {student.status !== "banned" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setBanOpen(true)}>
                <BanIcon data-icon="inline-start" />
                Ban…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={banOpen} onOpenChange={setBanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {student.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The student will be signed out immediately and unable to sign in
              until unbanned. This is used for serious exam-integrity violations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" />}
              onClick={() => submit("banned", { reason: "Banned by administrator" })}
            >
              Ban student
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function StudentsTable({
  students,
  viewerRole,
}: {
  students: SerializedWithId<UserDoc>[];
  viewerRole: Role;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {students.length} student{students.length === 1 ? "" : "s"} ·
            {viewerRole === "admin" ? " managed by you" : " across the platform"}
          </p>
        </div>
        <CreateStudentDialog />
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        {students.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
              <UserRoundPlusIcon className="size-6" />
            </span>
            <p className="font-medium">No students yet</p>
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              Add your first student — they&apos;ll be able to sign in and take
              the exams you assign.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{s.displayName}</span>
                      <span className="text-muted-foreground text-xs">{s.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.level === "primary"
                      ? `P${s.classLevel ?? "–"}`
                      : s.level === "secondary"
                        ? `S${s.classLevel ?? "–"} · ${s.secondarySubLevel === "a_level" ? "A" : "O"}`
                        : "–"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[s.status].variant}>
                      {STATUS_BADGE[s.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {s.lastLoginAt
                      ? format(parseDate(s.lastLoginAt)!, "d MMM yyyy, HH:mm")
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <StudentRowActions student={s} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
