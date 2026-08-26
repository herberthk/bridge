export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listStudentAttempts } from "@/server/services/attempts";
import { StudentExamsList } from "@/components/features/student/student-exams-list";
import { serializeDoc } from "@/lib/serialize";

export default async function StudentExamsPage() {
  const actor = await requireRole("student");
  let items = [] as Awaited<ReturnType<typeof listStudentAttempts>>;
  let loadFailed = false;
  try {
    items = await listStudentAttempts(actor);
  } catch (err) {
    console.error("[student/exams] load failed", err);
    loadFailed = true;
  }
  if (loadFailed) {
    return (
      <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
        Your exams could not be loaded. Try refreshing the page — if this keeps
        happening, contact your administrator.
      </p>
    );
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
