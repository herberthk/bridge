import type { Metadata } from "next";

import { requireRole } from "@/server/auth/session";
import { listExams } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { getRetakeCountsByExam } from "@/server/services/retakes";
import { ExamLibrary } from "@/components/features/admin/exam-library";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, ExamDoc, UserDoc } from "@/types/firestore";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exam Library | Bridge Admin",
  description:
    "Manage, review, filter and assign curriculum-aligned AI exams.",
};

export default async function AdminExamsPage() {
  const actor = await requireRole("admin");

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
      // Non-critical: Retake counts can fail gracefully
    }
  } catch (err) {
    console.error("[admin/exams] load failed", err);
    loadFailed = true;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadFailed && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-xs"
        >
          <p className="font-medium">Failed to load exam library</p>
          <p className="mt-0.5 text-xs text-destructive/80">
            Some data could not be fetched from the database. Please try refreshing the page.
          </p>
        </div>
      )}
      {examListIncomplete && !loadFailed && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 shadow-xs dark:text-amber-300"
        >
          <p className="font-medium">The exam library may be incomplete or out of order</p>
          <p className="mt-0.5 text-xs opacity-80">
            The creation-date query failed, so this page is showing a limited, unordered fallback.
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
