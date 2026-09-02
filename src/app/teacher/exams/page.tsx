export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listExams } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { getRetakeCountsByExam } from "@/server/services/retakes";
import { ExamLibrary } from "@/components/features/admin/exam-library";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, ExamDoc, UserDoc } from "@/types/firestore";

export default async function TeacherExamsPage() {
  const actor = await requireRole("teacher");

  let exams: WithId<ExamDoc>[] = [];
  let students: WithId<UserDoc>[] = [];
  let retakeCounts: Record<string, number> = {};
  let loadFailed = false;
  let examListIncomplete = false;
  try {
    const [examResult, loadedStudents] = await Promise.all([
      listExams(actor, 200),
      listStudents(actor),
    ]);
    exams = examResult.exams;
    students = loadedStudents;
    examListIncomplete = examResult.partial || !examResult.ordered;
    try {
      const map = await getRetakeCountsByExam(actor);
      retakeCounts = Object.fromEntries(map.entries());
    } catch {
      // Non-critical: retake counts can fail gracefully.
    }
  } catch (err) {
    console.error("[teacher/exams] load failed", err);
    loadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs">
          <p className="font-medium">Failed to load exam library</p>
        </div>
      )}
      {examListIncomplete && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 shadow-xs dark:text-amber-300">
          <p className="font-medium">The exam library may be incomplete or out of order</p>
        </div>
      )}
      <ExamLibrary
        exams={serializeDocs(exams)}
        students={serializeDocs(students)}
        retakeCounts={retakeCounts}
        basePath="/teacher"
      />
    </div>
  );
}
