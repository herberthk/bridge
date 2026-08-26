export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { countStudents, listStudents } from "@/server/services/users";
import { StudentsTable } from "@/components/features/admin/students-table";
import { serializeDocs } from "@/lib/serialize";

export default async function AdminStudentsPage() {
  const actor = await requireRole("admin");
  let students = [] as Awaited<ReturnType<typeof listStudents>>;
  let total: number | null = null;
  try {
    [students, total] = await Promise.all([
      listStudents(actor),
      countStudents(actor).catch(() => null),
    ]);
  } catch (err) {
    console.error("[students] list failed", err);
  }
  return (
    <StudentsTable
      students={serializeDocs(students)}
      viewerRole={actor.role}
      total={total}
    />
  );
}
