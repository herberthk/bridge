export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getExamForActor } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { attemptsCol } from "@/server/firebase/collections";
import { ExamDetailView } from "@/components/features/admin/exam-detail-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { AttemptDoc, UserDoc, WithId } from "@/types/firestore";

/**
 * Administrative Exam Intelligence & Analytics Dashboard.
 *
 * Provides a high-resolution, pedagogical view of an examination:
 * - Executive KPI telemetry (Average score, student coverage, pass rate, retake activity).
 * - Real-time student performance tracking with multi-attempt / retake delta analysis.
 * - Deep item difficulty analysis & error distribution with AI remedial diagnostics.
 * - Direct assignment and question review workflow integration.
 */
export default async function AdminExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const actor = await requireRole("admin", "super_admin");

  let exam: Awaited<ReturnType<typeof getExamForActor>> | null = null;
  try {
    exam = await getExamForActor(actor, examId);
  } catch {
    notFound();
  }
  if (!exam) notFound();

  let attemptsQuery = attemptsCol().where("examId", "==", examId);
  if (actor.role === "admin" && actor.schoolId) {
    attemptsQuery = attemptsQuery.where("schoolId", "==", actor.schoolId);
  }

  // Concurrently fetch attempts and student directory for fast initial page load
  const [attemptsSnapResult, studentsResult] = await Promise.allSettled([
    attemptsQuery.orderBy("createdAt", "desc").limit(200).get(),
    listStudents(actor).catch((err) => {
      console.error("[admin/exams/detail] student directory load failed", err);
      return [] as WithId<UserDoc>[];
    }),
  ]);

  const attempts: WithId<AttemptDoc>[] =
    attemptsSnapResult.status === "fulfilled"
      ? attemptsSnapResult.value.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      : [];

  const students: WithId<UserDoc>[] =
    studentsResult.status === "fulfilled" ? studentsResult.value : [];

  return (
    <ExamDetailView
      exam={serializeDoc(exam)}
      attempts={serializeDocs(attempts)}
      students={serializeDocs(students)}
    />
  );
}
