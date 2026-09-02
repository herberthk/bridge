export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listClasses } from "@/server/services/classes";
import { getSchoolById } from "@/server/services/schools";
import { ClassCardGrid, teacherNamesForClass } from "@/components/features/school/class-card-grid";
import { CreateClassDialog } from "@/components/features/school/create-class-dialog";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import { listSchoolStaff } from "@/server/services/users";

export default async function TeacherClassesPage() {
  const actor = await requireRole("teacher");

  const [classes, school, staff] = await Promise.all([
    listClasses(actor),
    actor.schoolId
      ? getSchoolById(actor.schoolId).catch(() => null)
      : Promise.resolve(null),
    listSchoolStaff(actor).catch(() => ({ admins: [], teachers: [] })),
  ]);
  const serialized = classes.map((c) => serializeDoc(c));
  const staffSerialized = serializeDocs([...staff.admins, ...staff.teachers]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My classes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Open a class for its roster, leaderboard and performance — or create
            a missing class.
          </p>
        </div>
        {school && (
          <CreateClassDialog
            schoolLevel={school.level}
            existingClassLevels={classes.map((c) => c.classLevel)}
            triggerLabel="New class"
          />
        )}
      </div>

      <ClassCardGrid
        items={serialized.map((cls) => ({
          cls,
          teacherNames: teacherNamesForClass(cls, staffSerialized),
        }))}
        basePath="/teacher"
        emptyTitle="No classes assigned yet"
        emptyHint="Your admin assigns classes to you — or create a class yourself if it's missing."
      />
    </div>
  );
}
