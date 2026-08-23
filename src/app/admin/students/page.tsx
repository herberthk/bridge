export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudents } from "@/server/services/users";
import { StudentsTable } from "@/components/features/admin/students-table";
import { serializeDocs } from "@/lib/serialize";

export default async function AdminStudentsPage() {
  const actor = await requireRole("admin");
  let students = [] as Awaited<ReturnType<typeof listStudents>>;
  try {
    students = await listStudents(actor);
  } catch (err) {
    console.error("[students] list failed", err);
  }
  return <StudentsTable students={serializeDocs(students)} viewerRole={actor.role} />;
}
