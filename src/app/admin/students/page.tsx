export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudents } from "@/server/services/users";
import { StudentsTable } from "@/components/features/admin/students-table";

export default async function AdminStudentsPage() {
  const actor = await requireRole("admin");
  let students = [] as Awaited<ReturnType<typeof listStudents>>;
  try {
    students = await listStudents(actor);
  } catch (err) {
    console.error("[students] list failed", err);
  }
  return <StudentsTable students={students} viewerRole={actor.role} />;
}
