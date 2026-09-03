export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudents } from "@/server/services/users";
import { listClasses } from "@/server/services/classes";
import { StudentsTable } from "@/components/features/admin/students-table";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, UserDoc, ClassDoc } from "@/types/firestore";

export default async function TeacherStudentsPage() {
  const actor = await requireRole("teacher");

  let students: WithId<UserDoc>[] = [];
  let classes: WithId<ClassDoc>[] = [];
  let studentLoadFailed = false;
  let classLoadFailed = false;

  // listClasses is assigned-only for teachers — the dialog can only offer
  // those classes, matching the server-side creation rule.
  const [studentsResult, classesResult] = await Promise.allSettled([
    listStudents(actor),
    listClasses(actor),
  ]);

  if (studentsResult.status === "fulfilled") {
    students = studentsResult.value;
  } else {
    console.error("[teacher/students] student list failed", studentsResult.reason);
    studentLoadFailed = true;
  }
  if (classesResult.status === "fulfilled") {
    classes = classesResult.value;
  } else {
    console.error("[teacher/students] class list failed", classesResult.reason);
    classLoadFailed = true;
  }

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
        viewerRole="teacher"
        total={students.length}
        classes={classes.map(({ id, name }) => ({ id, name }))}
        classLoadFailed={classLoadFailed}
      />
    </div>
  );
}
