export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import {
  getClassForActor,
  listStudentsInClass,
} from "@/server/services/classes";
import {
  getClassLeaderboard,
  getClassExamPerformance,
} from "@/server/services/leaderboard";
import { listExams } from "@/server/services/exams";
import { ClassDashboardView } from "@/components/features/school/class-dashboard-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { ExamDoc, WithId } from "@/types/firestore";

/** Admin view of one class: roster, leaderboard and performance. */
export default async function AdminClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const actor = await requireRole("admin");

  let cls: Awaited<ReturnType<typeof getClassForActor>> | null = null;
  try {
    cls = await getClassForActor(actor, classId);
  } catch {
    notFound();
  }
  if (!cls) notFound();

  const [students, leaderboardResult, performance, examsResult] = await Promise.all([
    listStudentsInClass(actor, classId).catch(() => []),
    getClassLeaderboard(actor, classId).catch(() => null),
    getClassExamPerformance(actor, classId).catch(() => []),
    listExams(actor, 200).catch(() => ({ exams: [] as WithId<ExamDoc>[], partial: false, ordered: true })),
  ]);

  const classExams = examsResult.exams.filter((e) => e.classId === classId);

  return (
    <ClassDashboardView
      cls={serializeDoc(cls)}
      basePath="/admin"
      students={serializeDocs(students)}
      leaderboard={leaderboardResult?.entries ?? []}
      stats={
        leaderboardResult?.stats ?? {
          students: students.length,
          gradedAttempts: 0,
          averagePercentage: null,
          participationRate: 0,
          topPercentage: null,
        }
      }
      examPerformance={performance}
      classExams={serializeDocs(classExams)}
      canManage
    />
  );
}
