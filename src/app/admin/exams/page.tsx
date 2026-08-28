export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listExams } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { getRetakeCountsByExam } from "@/server/services/retakes";
import { ExamLibrary } from "@/components/features/admin/exam-library";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, ExamDoc, UserDoc } from "@/types/firestore";

export default async function AdminExamsPage() {
  const actor = await requireRole("admin");

  let exams: WithId<ExamDoc>[] = [];
  let students: WithId<UserDoc>[] = [];
  let retakeCounts: Record<string, number> = {};
  let loadFailed = false;
  try {
    [exams, students] = await Promise.all([
      listExams(actor),
      listStudents(actor),
    ]);
    try {
      const map = await getRetakeCountsByExam(actor);
      retakeCounts = Object.fromEntries(map.entries());
    } catch {}
  } catch (err) {
    console.error("[admin/exams] load failed", err);
    loadFailed = true;
  }

  return (
    <>
      {loadFailed && (
        <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Your exam library could not be loaded. Try refreshing the page.
        </p>
      )}
      <ExamLibrary exams={serializeDocs(exams)} students={serializeDocs(students)} retakeCounts={retakeCounts} />
    </>
  );
}
