"use client";

import { useActionState, useRef, useState } from "react";
import {
  CheckIcon,
  CircleCheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createStudentAction, type ActionState } from "@/app/admin/actions";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDisplay,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useActionToast } from "@/components/features/super/schools-manager";
import { generateTempPassword } from "@/lib/temp-password";
import { cn } from "@/lib/utils";

export interface CreatableClass {
  id: string;
  name: string;
}

interface CreatedSnapshot {
  displayName: string;
  email: string;
  password: string;
  className: string;
}

async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  } catch {
    toast.error("Copy failed — select the text manually.");
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setCopied(true);
        void copyText(text, label).finally(() =>
          window.setTimeout(() => setCopied(false), 1500),
        );
      }}
      aria-label={`Copy ${label}`}
      className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
    >
      {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
    </button>
  );
}

/**
 * Premium student-enrollment dialog.
 *
 * Role scoping is enforced by the caller: `classes` must already be limited
 * (assigned-only for teachers, whole school for admins) and the server
 * re-validates. In `fixedClassId` mode (class dashboards) the class is pinned
 * and shown as locked.
 */
export function CreateStudentDialog({
  classes,
  fixedClassId,
  fixedClassName,
  triggerLabel = "Add student",
  disabled = false,
}: {
  classes: CreatableClass[];
  fixedClassId?: string;
  fixedClassName?: string;
  triggerLabel?: string;
  disabled?: boolean;
}) {
  const pinned = Boolean(fixedClassId);
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [classId, setClassId] = useState("");
  const [created, setCreated] = useState<CreatedSnapshot | null>(null);
  const submittedRef = useRef<CreatedSnapshot | null>(null);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createStudentAction,
    null,
  );
  // On success, snapshot the credentials for the summary panel instead of
  // closing — the password exists only in this form, so this is the one
  // moment it can be shared.
  useActionToast(
    state,
    created
      ? undefined
      : () => {
          if (submittedRef.current) setCreated(submittedRef.current);
        },
    "Student created",
  );

  const resetForm = () => {
    setDisplayName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setClassId("");
    setCreated(null);
    submittedRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setCreated(null);
    if (!next) resetForm();
  };

  const canSubmit =
    !pending &&
    displayName.trim().length >= 2 &&
    email.trim().length > 3 &&
    password.length >= 10 &&
    (pinned || classId !== "");

  const selectedClassName =
    (fixedClassId ? fixedClassName : classes.find((c) => c.id === classId)?.name) ??
    "their class";

  const handleFormAction = (formData: FormData) => {
    const snapshot = {
      displayName: String(formData.get("displayName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? "").trim(),
      className: String(formData.get("className") ?? "").trim(),
    } satisfies CreatedSnapshot;

    // Keep the dispatched credentials identical to the success snapshot.
    formData.set("displayName", snapshot.displayName);
    formData.set("email", snapshot.email);
    formData.set("password", snapshot.password);
    submittedRef.current = snapshot;
    formAction(formData);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button className="shadow-glow" disabled={disabled} />}>
        <PlusIcon data-icon="inline-start" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CircleCheckIcon className="size-5" aria-hidden />
                </span>
                <div>
                  <DialogTitle>Student created</DialogTitle>
                  <DialogDescription>
                    Share these credentials with the student — the temporary
                    password won&apos;t be shown again.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <dl className="mt-4 flex flex-col gap-2">
              {(
                [
                  ["Name", created.displayName, created.displayName],
                  ["Class", created.className, created.className],
                  ["Email", created.email, created.email],
                  ["Temporary password", created.password, "Temporary password"],
                ] as const
              ).map(([term, value, label]) => (
                <div
                  key={term}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                      {term}
                    </dt>
                    <dd
                      className={cn(
                        "truncate text-sm font-semibold",
                        term === "Temporary password" && "font-mono tabular-nums",
                      )}
                    >
                      {value}
                    </dd>
                  </div>
                  <CopyButton text={value} label={label} />
                </div>
              ))}
            </dl>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={resetForm}>
                Add another
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <span className="bg-brand text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-md">
                  <UserRoundPlusIcon className="size-5" aria-hidden />
                </span>
                <div>
                  <DialogTitle>Add a student</DialogTitle>
                  <DialogDescription>
                    {pinned ? (
                      <>
                        Enrolling into{" "}
                        <span className="font-semibold text-foreground">
                          {fixedClassName ?? "this class"}
                        </span>
                        . The account is created instantly.
                      </>
                    ) : (
                      "The student joins the selected class immediately — level and year follow the class."
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <form action={handleFormAction} className="mt-4">
              <FieldGroup>
                <input type="hidden" name="classId" value={fixedClassId ?? classId} />
                <input type="hidden" name="className" value={selectedClassName} />
                {pinned ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-3.5 py-2.5">
                    <span className="text-sm font-semibold">{fixedClassName ?? "This class"}</span>
                    <Badge variant="secondary" className="gap-1">
                      <LockIcon className="size-3" aria-hidden />
                      Fixed
                    </Badge>
                  </div>
                ) : classes.length === 0 ? (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-300">
                    No classes available. Ask your admin to assign you a class first.
                  </p>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="student-class">Class</FieldLabel>
                    <Select value={classId} onValueChange={(v) => setClassId(v ?? "")}>
                      <SelectTrigger id="student-class" className="w-full">
                        <SelectDisplay
                          value={classId}
                          placeholder="Choose a class…"
                          options={classes.map((c) => ({ value: c.id, label: c.name }))}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="displayName">Full name</FieldLabel>
                    <Input
                      id="displayName"
                      name="displayName"
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="off"
                      placeholder="e.g. Aisha Nakato"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="off"
                      placeholder="student@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="password">Temporary password</FieldLabel>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={10}
                      autoComplete="new-password"
                      placeholder="10+ chars, mixed case, number"
                      className="pr-20 font-mono"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                      <button
                        type="button"
                        onClick={() => setPassword(generateTempPassword())}
                        aria-label="Generate a password"
                        title="Generate a password"
                        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 items-center justify-center rounded-md transition-colors"
                      >
                        <RefreshCwIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 items-center justify-center rounded-md transition-colors"
                      >
                        {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <FieldDescription>
                    At least 10 characters with upper/lowercase and a number.
                  </FieldDescription>
                </Field>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {pending ? "Creating…" : "Create student"}
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
