"use client";

import { useActionState, useMemo } from "react";
import { format } from "date-fns";
import { BadgeCheckIcon, Building2Icon, ListChecksIcon, SaveIcon, ShieldQuestionIcon } from "lucide-react";

import {
  requestVerificationAction,
  updateSchoolProfileAction,
} from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { SchoolDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { AdminPageHeader } from "@/components/features/admin/admin-page-header";
import { getSchoolProfileCompleteness } from "@/lib/admin-ui";
import { useActionToast } from "@/components/features/super/schools-manager";
import type { SchoolVerificationStatus } from "@/lib/constants";

/** School profile editor + blue-tick verification request. */
export function SchoolProfileView({ school }: { school: SerializedWithId<SchoolDoc> }) {
  const [profileState, profileAction, profilePending] = useActionState<
    ActionState | null,
    FormData
  >(updateSchoolProfileAction, null);
  const [verifyState, verifyAction, verifyPending] = useActionState<
    ActionState | null,
    FormData
  >(requestVerificationAction, null);
  useActionToast(profileState, undefined, "School profile saved");
  useActionToast(verifyState, undefined, "Verification requested");

  const canRequest =
    school.verification === "unverified" &&
    Boolean(school.registrationNumber?.trim()) &&
    Boolean(school.address?.trim());

  const completeness = useMemo(
    () =>
      getSchoolProfileCompleteness({
        name: school.name,
        motto: school.motto,
        phone: school.phone,
        email: school.email,
        address: school.address,
        registrationNumber: school.registrationNumber,
        description: school.description,
      }),
    [
      school.name,
      school.motto,
      school.phone,
      school.email,
      school.address,
      school.registrationNumber,
      school.description,
    ],
  );

  const createdLabel = school.createdAt
    ? format(new Date(school.createdAt as unknown as string), "d MMMM yyyy")
    : "—";

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        icon={<Building2Icon className="size-5" />}
        eyebrow="School administration"
        title={school.name?.trim() || "School profile"}
        description={`${school.level === "primary" ? "Primary" : "Secondary"} school · Created ${createdLabel} · Keep public details accurate — they appear to teachers, students and the platform.`}
        actions={<VerifiedBadge status={school.verification} size="md" />}
      />

      {/* Profile strength — guides admins to a verification-ready profile. */}
      <Card className="shadow-card overflow-hidden">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
              <ListChecksIcon className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                Profile strength {completeness.percent}%
                <span className="text-muted-foreground font-normal">
                  {" "}· {completeness.completed}/{completeness.total} fields complete
                </span>
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {completeness.missing.length === 0
                  ? "Complete — your school is ready for verification review."
                  : `Next: add ${completeness.missing.slice(0, 3).join(", ")}${completeness.missing.length > 3 ? ` +${completeness.missing.length - 3} more` : ""}.`}
              </p>
            </div>
          </div>
          <div
            className="bg-muted h-2 w-full overflow-hidden rounded-full sm:w-56"
            role="progressbar"
            aria-valuenow={completeness.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="School profile completeness"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${completeness.percent}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-card overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <CardTitle>Public details</CardTitle>
          <CardDescription>
            Shown to teachers, students and the platform. Accurate details are
            required for blue-tick verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="name">School name</FieldLabel>
                  <Input id="name" name="name" defaultValue={school.name} required minLength={2} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="motto">Motto</FieldLabel>
                  <Input id="motto" name="motto" defaultValue={school.motto ?? ""} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input id="phone" name="phone" defaultValue={school.phone ?? ""} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">Contact email</FieldLabel>
                  <Input id="email" name="email" type="email" defaultValue={school.email ?? ""} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="address">Address</FieldLabel>
                  <Input id="address" name="address" defaultValue={school.address ?? ""} />
                  <FieldDescription>Physical location of the school.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="registrationNumber">Registration / EMIS number</FieldLabel>
                  <Input
                    id="registrationNumber"
                    name="registrationNumber"
                    defaultValue={school.registrationNumber ?? ""}
                    placeholder="e.g. PSS/2019/014"
                  />
                  <FieldDescription>
                    The official number that distinguishes your school from
                    similarly named ones.
                  </FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="description">Description</FieldLabel>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  defaultValue={school.description ?? ""}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" disabled={profilePending} className="shadow-glow">
                  <SaveIcon data-icon="inline-start" />
                  {profilePending ? "Saving…" : "Save profile"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-card overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <CardTitle className="flex items-center gap-2">
            <BadgeCheckIcon className="size-4 text-sky-500" />
            Verification
          </CardTitle>
          <CardDescription>
            Verified schools get a{" "}
            <VerifiedBadge status="verified" /> — confirming to teachers,
            parents and students that this is the official {school.name}. Review
            typically follows once registration details are complete.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  school.verification === "verified"
                    ? "secondary"
                    : school.verification === "pending"
                      ? "outline"
                      : "destructive"
                }
                className="capitalize"
              >
                {school.verification === "unverified" ? "not verified" : school.verification}
              </Badge>
              <SchoolVerificationHint status={school.verification} />
            </div>
            {school.verification === "unverified" &&
              (!school.registrationNumber?.trim() || !school.address?.trim()) && (
                <p className="text-muted-foreground text-xs">
                  Add your registration number and address above, save, then
                  request verification.
                </p>
              )}
          </div>
          {school.verification === "unverified" && (
            <form action={verifyAction}>
              <Button type="submit" disabled={verifyPending || !canRequest}>
                <ShieldQuestionIcon data-icon="inline-start" />
                {verifyPending ? "Submitting…" : "Request verification"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SchoolVerificationHint({
  status,
}: {
  status: SchoolVerificationStatus;
}) {
  if (status === "verified") {
    return <span className="text-muted-foreground text-xs">Verified by the platform team.</span>;
  }
  if (status === "pending") {
    return (
      <span className="text-muted-foreground text-xs">
        A super admin will review your details shortly.
      </span>
    );
  }
  return (
    <span className="text-muted-foreground text-xs">
      Optional, but recommended — it builds trust in your results.
    </span>
  );
}
