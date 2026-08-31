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
      listExams(actor, 200),
      listStudents(actor),
    ]);
    try {
      const map = await getRetakeCountsByExam(actor);
      retakeCounts = Object.fromEntries(map.entries());
    } catch {
      // Non-critical: Retake counts can fail gracefully
    }
  } catch (err) {
    console.error("[admin/exams] load failed", err);
    loadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load exam library</p>
          <p className="mt-0.5 text-xs text-destructive/80">
            Some data could not be fetched from the database. Please try refreshing the page.
          </p>
        </div>
      )}
      <ExamLibrary
        exams={serializeDocs(exams)}
        students={serializeDocs(students)}
        retakeCounts={retakeCounts}
      />
    </div>
  );
}
