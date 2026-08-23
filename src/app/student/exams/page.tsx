export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudentAttempts } from "@/server/services/attempts";
import { StudentExamsList } from "@/components/features/student/student-exams-list";
import { serializeDoc } from "@/lib/serialize";

export default async function StudentExamsPage() {
  const actor = await requireRole("student");
  let items = [] as Awaited<ReturnType<typeof listStudentAttempts>>;
  try {
    items = await listStudentAttempts(actor);
  } catch (err) {
    console.error("[student/exams] load failed", err);
  }
  return (
    <StudentExamsList
      items={items.map((i) => ({
        attempt: serializeDoc(i.attempt),
        exam: i.exam,
      }))}
    />
  );
}
