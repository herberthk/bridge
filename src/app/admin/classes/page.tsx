export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listClasses } from "@/server/services/classes";
import { getSchoolById } from "@/server/services/schools";
import { listSchoolStaff } from "@/server/services/users";
import { ClassCardGrid, teacherNamesForClass } from "@/components/features/school/class-card-grid";
import { CreateClassDialog } from "@/components/features/school/create-class-dialog";
import { serializeDoc, serializeDocs } from "@/lib/serialize";

export default async function AdminClassesPage() {
  const actor = await requireRole("admin");

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
          <h1 className="text-2xl font-semibold tracking-tight">Classes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your school&apos;s classes — rosters, leaderboards and exams
            live in each class dashboard.
          </p>
        </div>
        {school && (
          <CreateClassDialog
            schoolLevel={school.level}
            existingClassLevels={classes.map((c) => c.classLevel)}
          />
        )}
      </div>

      <ClassCardGrid
        items={serialized.map((cls) => ({
          cls,
          teacherNames: teacherNamesForClass(cls, staffSerialized),
        }))}
        basePath="/admin"
        header={{
          schoolName: school?.name,
          verification: school?.verification,
          totalStudents: classes.reduce((n, c) => n + (c.studentCount ?? 0), 0),
        }}
      />
    </div>
  );
}
