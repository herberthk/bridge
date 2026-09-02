"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Building2Icon,
  CheckIcon,
  GraduationCapIcon,
  Loader2Icon,
  SchoolIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";

import { createMySchoolAction } from "@/app/onboarding/actions";
import type { ActionState } from "@/app/admin/actions";
import {
  classLabel,
  standardClassLevelsForLevel,
  type SchoolLevel,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { refreshSession } from "@/components/auth-sync";
import { cn } from "@/lib/utils";

const STEPS = ["School details", "Level & classes", "Review"] as const;

/**
 * Onboarding wizard: a member creates their school and becomes its admin.
 * Level is a single exclusive choice — primary OR secondary — and the class
 * set follows from it (P1–P7 or S1–S6).
 */
export function SchoolWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    createMySchoolAction,
    null,
  );
  const [level, setLevel] = useState<SchoolLevel>("primary");
  const [selected, setSelected] = useState<number[]>(
    [...standardClassLevelsForLevel("primary")],
  );
  const [name, setName] = useState("");

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success("School created — welcome aboard!");
      void (async () => {
        // The action just promoted us member → admin via custom claims, but
        // the current session cookie still carries the old "member" claim —
        // /admin would bounce straight back here. Force a token refresh and
        // re-mint the cookie before navigating.
        const refreshed = await refreshSession();
        if (!refreshed) {
          toast.error("Session refresh failed — please sign in again.");
          router.replace("/login");
          return;
        }
        router.replace("/admin");
        router.refresh();
      })();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  const levelClassCount = useMemo(
    () => standardClassLevelsForLevel(level).length,
    [level],
  );

  const changeLevel = (next: SchoolLevel) => {
    setLevel(next);
    setSelected([...standardClassLevelsForLevel(next)]);
  };

  const toggle = (n: number) =>
    setSelected((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div className="gradient-border shadow-lifted relative w-full max-w-2xl overflow-hidden rounded-3xl bg-card/95 backdrop-blur-xl">
      {/* Progress */}
      <div className="flex items-center gap-2 border-b border-border/60 px-8 py-5">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                i < step
                  ? "border-primary bg-primary text-primary-foreground"
                  : i === step
                    ? "border-primary text-primary"
                    : "text-muted-foreground border-border",
              )}
            >
              {i < step ? <CheckIcon className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "hidden text-xs font-medium sm:block",
                i === step ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px flex-1",
                  i < step ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>

      <form action={formAction}>
        {state && !state.ok && (
          <p className="border-destructive/30 bg-destructive/10 text-destructive border-b px-8 py-3 text-sm">
            {state.error}
          </p>
        )}
        {/* Step 1 — school details */}
        <div className={cn("flex flex-col gap-5 p-8", step !== 0 && "hidden")}>
          <div className="flex flex-col gap-1.5">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Building2Icon className="text-primary size-5" />
              Tell us about your school
            </h1>
            <p className="text-muted-foreground text-sm">
              This is how your school appears to teachers, students and the
              platform. You can update it later from School Profile.
            </p>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">School name</FieldLabel>
              <Input
                id="name"
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. St. Mary's College Kisubi"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="motto">Motto (optional)</FieldLabel>
                <Input id="motto" name="motto" maxLength={140} placeholder="e.g. Discipline & Excellence" />
              </Field>
              <Field>
                <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
                <Input id="phone" name="phone" maxLength={20} placeholder="+256 …" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="email">Contact email (optional)</FieldLabel>
                <Input id="email" name="email" type="email" placeholder="info@school.ac.ug" />
              </Field>
              <Field>
                <FieldLabel htmlFor="registrationNumber">
                  Registration / EMIS number (optional)
                </FieldLabel>
                <Input id="registrationNumber" name="registrationNumber" placeholder="e.g. PSS/2019/014" />
                <FieldDescription>
                  Needed later to request your blue-tick verification.
                </FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="address">Address (optional)</FieldLabel>
              <Input id="address" name="address" maxLength={200} placeholder="Town, district" />
            </Field>
            <Field>
              <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
              <Textarea
                id="description"
                name="description"
                rows={2}
                maxLength={500}
                placeholder="A line or two about your school"
              />
            </Field>
          </FieldGroup>
        </div>

        {/* Step 2 — level & classes */}
        <div className={cn("flex flex-col gap-5 p-8", step !== 1 && "hidden")}>
          <div className="flex flex-col gap-1.5">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <GraduationCapIcon className="text-primary size-5" />
              Choose your school level
            </h1>
            <p className="text-muted-foreground text-sm">
              A school is <strong>either primary or secondary</strong> — this
              determines the curriculum and the standard classes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "primary" as const,
                  title: "Primary school",
                  desc: "Primary 1 – Primary 7 (PLE curriculum)",
                },
                {
                  value: "secondary" as const,
                  title: "Secondary school",
                  desc: "Senior 1 – 4 (O level) and Senior 5 – 6 (A level)",
                },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={level === opt.value}
                onClick={() => changeLevel(opt.value)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-all",
                  level === opt.value
                    ? "border-primary bg-primary/5 ring-primary/30 ring-2"
                    : "hover:bg-accent/60",
                )}
              >
                <p className="font-semibold">{opt.title}</p>
                <p className="text-muted-foreground mt-1 text-xs">{opt.desc}</p>
              </button>
            ))}
          </div>

          <Field>
            <FieldLabel>
              Classes to create ({selected.length} of {levelClassCount} standard)
            </FieldLabel>
            <FieldDescription>
              Pre-selected for you — untick any you don&apos;t need yet. You can
              create the rest later.
            </FieldDescription>
            <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {standardClassLevelsForLevel(level).map((n) => {
                const active = selected.includes(n);
                return (
                  <button
                    type="button"
                    key={n}
                    aria-pressed={active}
                    onClick={() => toggle(n)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary ring-primary/30 ring-2"
                        : "hover:bg-accent/60",
                    )}
                  >
                    {classLabel(level, n)}
                  </button>
                );
              })}
            </div>
            {selected.map((n) => (
              <input key={n} type="hidden" name="classLevels" value={n} />
            ))}
          </Field>
        </div>

        {/* Step 3 — review */}
        <div className={cn("flex flex-col gap-5 p-8", step !== 2 && "hidden")}>
          <div className="flex flex-col gap-1.5">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <SparklesIcon className="text-primary size-5" />
              Review &amp; create
            </h1>
            <p className="text-muted-foreground text-sm">
              You&apos;ll become this school&apos;s admin — you can invite
              teachers and add students right after.
            </p>
          </div>
          <div className="bg-muted/40 flex flex-col gap-3 rounded-2xl border p-5">
            <div className="flex items-center gap-3">
              <span className="bg-brand-soft text-accent-foreground flex size-10 items-center justify-center rounded-xl">
                <SchoolIcon className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{name || "Your school"}</p>
                <p className="text-muted-foreground text-xs">
                  {level === "primary" ? "Primary school" : "Secondary school"} ·{" "}
                  {selected.length} class{selected.length === 1 ? "" : "es"}:{" "}
                  {selected
                    .slice()
                    .sort((a, b) => a - b)
                    .map((n) => classLabel(level, n))
                    .join(", ") || "none selected"}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              {format(new Date(), "d MMMM yyyy")} — verified blue tick can be
              requested once your registration details are complete.
            </p>
          </div>
        </div>

        {/* Hidden step-1 fields persist across steps (same form element). */}
        <div className="hidden">
          <input
            type="text"
            name="level"
            value={level}
            readOnly
          />
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between border-t border-border/60 px-8 py-5">
          <Button
            type="button"
            variant="ghost"
            onClick={back}
            disabled={step === 0 || pending}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next} disabled={step === 0 && name.trim().length < 2}>
              Continue
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          ) : (
            <Button type="submit" disabled={pending || selected.length === 0}>
              {pending ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                  Creating school…
                </>
              ) : (
                <>
                  <SparklesIcon data-icon="inline-start" />
                  Create school
                </>
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
