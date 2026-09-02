export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudents } from "@/server/services/users";
import { StudentsTable } from "@/components/features/admin/students-table";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, UserDoc } from "@/types/firestore";

export default async function TeacherStudentsPage() {
  const actor = await requireRole("teacher");

  let students: WithId<UserDoc>[] = [];
  let loadFailed = false;
  try {
    students = await listStudents(actor);
  } catch (err) {
    console.error("[teacher/students] load failed", err);
    loadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load students</p>
        </div>
      )}
      <StudentsTable
        students={serializeDocs(students)}
        viewerRole="teacher"
        total={students.length}
      />
    </div>
  );
}
