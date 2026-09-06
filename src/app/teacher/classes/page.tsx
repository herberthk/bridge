export const dynamic = "force-dynamic";

import { BookOpenCheckIcon, PlusIcon, SchoolIcon, UsersIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { listAssignedClassLevels, listClasses } from "@/server/services/classes";
import { canTeacherCreateClasses } from "@/server/services/users";
import { getSchoolById } from "@/server/services/schools";
import { ClassCardGrid, teacherNamesForClass } from "@/components/features/school/class-card-grid";
import { CreateClassDialog } from "@/components/features/school/create-class-dialog";
import { VerifiedBadge } from "@/components/features/school/verified-badge";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import { listSchoolStaff } from "@/server/services/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function TeacherClassesPage() {
  const actor = await requireRole("teacher");

  // UI hint only — `createClasses` re-checks the privilege server-side.
  const [classes, canCreate] = await Promise.all([
    // listClasses already scopes teachers to assigned-only, so every card
    // the teacher sees is openable (no 404 on click).
    listClasses(actor),
    canTeacherCreateClasses(actor.uid).catch(() => false),
  ]);
  // The claim dialog is the only consumer of assigned levels — skip the
  // school-wide scan for teachers who can never open it.
  const [assignedClassLevels, school, staff] = await Promise.all([
    canCreate ? listAssignedClassLevels(actor) : Promise.resolve([] as number[]),
    actor.schoolId
      ? getSchoolById(actor.schoolId).catch(() => null)
      : Promise.resolve(null),
    listSchoolStaff(actor).catch(() => ({ admins: [], teachers: [] })),
  ]);
  const serialized = classes.map((c) => serializeDoc(c));
  const staffSerialized = serializeDocs([...staff.admins, ...staff.teachers]);
  const totalStudents = classes.reduce((n, c) => n + (c.studentCount ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Premium hero — pure RSC, CSS-only backdrop (no client JS). */}
      <section className="bg-mesh relative overflow-hidden rounded-2xl border">
        <div
          aria-hidden
          className="bg-brand-soft pointer-events-none absolute inset-0"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-5 p-6 sm:p-7">
          <div className="min-w-0 max-w-2xl">
            <Badge variant="secondary" className="mb-3">
              Teacher workspace
              {school ? ` · ${school.name}` : ""}
            </Badge>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight text-balance sm:text-[1.7rem]">
              My classes
              <span className="text-muted-foreground text-base font-normal tabular-nums">
                {classes.length} assigned
              </span>
              {school ? <VerifiedBadge status={school.verification} /> : null}
            </h1>
            <p className="text-muted-foreground mt-1.5 max-w-xl text-sm text-pretty">
              Only classes assigned to you appear here — open one for its
              roster, leaderboard and performance
              {canCreate
                ? ", or create a missing class to claim it."
                : ". Your admin creates and assigns classes."}
            </p>
            <dl className="mt-4 flex flex-wrap gap-2.5 text-sm">
              <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2">
                <BookOpenCheckIcon className="text-primary size-4" aria-hidden />
                <dt className="text-muted-foreground">Classes</dt>
                <dd className="font-semibold tabular-nums">{classes.length}</dd>
              </div>
              <div className="glass flex items-center gap-2 rounded-xl px-3.5 py-2">
                <UsersIcon className="text-primary size-4" aria-hidden />
                <dt className="text-muted-foreground">Students</dt>
                <dd className="font-semibold tabular-nums">{totalStudents}</dd>
              </div>
              <div className="glass hidden items-center gap-2 rounded-xl px-3.5 py-2 sm:flex">
                <SchoolIcon className="text-primary size-4" aria-hidden />
                <dt className="text-muted-foreground">School</dt>
                <dd className="max-w-44 truncate font-semibold">
                  {school?.name ?? "—"}
                </dd>
              </div>
            </dl>
          </div>
          {school &&
            (canCreate ? (
              <div className="shrink-0">
                <CreateClassDialog
                  schoolLevel={school.level}
                  // Hide every school-wide class that already has a teacher;
                  // unassigned existing classes remain available to claim.
                  existingClassLevels={assignedClassLevels}
                  triggerLabel="New class"
                  mode="claim"
                />
              </div>
            ) : (
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span title="Your admin hasn't granted you class creation — ask them to create or assign classes.">
                  <Button disabled>
                    <PlusIcon data-icon="inline-start" />
                    New class
                  </Button>
                </span>
                <p className="text-muted-foreground max-w-52 text-right text-xs">
                  Ask your admin to create or assign classes.
                </p>
              </div>
            ))}
        </div>
      </section>

      <ClassCardGrid
        items={serialized.map((cls) => ({
          cls,
          teacherNames: teacherNamesForClass(cls, staffSerialized),
        }))}
        basePath="/teacher"
        emptyTitle="No classes assigned yet"
        emptyHint={
          canCreate
            ? "Your admin assigns classes to you — or use New class above to create and claim a missing one."
            : "Your admin assigns classes to you — ask them to create or assign a class."
        }
      />
    </div>
  );
}
