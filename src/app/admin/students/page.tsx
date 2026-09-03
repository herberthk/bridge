export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { countStudents, listStudents } from "@/server/services/users";
import { listClasses } from "@/server/services/classes";
import { StudentsTable } from "@/components/features/admin/students-table";
import { serializeDocs } from "@/lib/serialize";

export default async function AdminStudentsPage() {
  const actor = await requireRole("admin");
  let students = [] as Awaited<ReturnType<typeof listStudents>>;
  let classes = [] as Awaited<ReturnType<typeof listClasses>>;
  let total: number | null = null;
  let studentLoadFailed = false;
  let classLoadFailed = false;

  const [studentsResult, classesResult, totalResult] = await Promise.allSettled([
    listStudents(actor),
    // Whole school for admins — the dialog offers every class.
    listClasses(actor),
    countStudents(actor),
  ]);

  if (studentsResult.status === "fulfilled") {
    students = studentsResult.value;
  } else {
    console.error("[students] list failed", studentsResult.reason);
    studentLoadFailed = true;
  }
  if (classesResult.status === "fulfilled") {
    classes = classesResult.value;
  } else {
    console.error("[students] class list failed", classesResult.reason);
    classLoadFailed = true;
  }
  if (totalResult.status === "fulfilled") total = totalResult.value;

  return (
    <div className="flex flex-col gap-6">
      {studentLoadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load students</p>
        </div>
      )}
      {classLoadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load classes. Student enrollment is unavailable.</p>
        </div>
      )}
      <StudentsTable
        students={serializeDocs(students)}
        viewerRole={actor.role}
        total={total}
        classes={classes.map(({ id, name }) => ({ id, name }))}
        classLoadFailed={classLoadFailed}
      />
    </div>
  );
}
