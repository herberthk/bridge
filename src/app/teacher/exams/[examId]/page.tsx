export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getExamForActor } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { attemptsCol } from "@/server/firebase/collections";
import { ExamDetailView } from "@/components/features/admin/exam-detail-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { AttemptDoc, UserDoc, WithId } from "@/types/firestore";

export default async function TeacherExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const actor = await requireRole("teacher");

  let exam: Awaited<ReturnType<typeof getExamForActor>> | null = null;
  try {
    exam = await getExamForActor(actor, examId);
  } catch {
    notFound();
  }
  if (!exam) notFound();

  let attemptsQuery = attemptsCol().where("examId", "==", examId);
  if (actor.schoolId) {
    attemptsQuery = attemptsQuery.where("schoolId", "==", actor.schoolId);
  }

  const [attemptsSnapResult, studentsResult] = await Promise.allSettled([
    attemptsQuery.orderBy("createdAt", "desc").limit(200).get(),
    listStudents(actor).catch(() => [] as WithId<UserDoc>[]),
  ]);

  const attempts: WithId<AttemptDoc>[] =
    attemptsSnapResult.status === "fulfilled"
      ? attemptsSnapResult.value.docs.map((d) => ({ id: d.id, ...d.data() }))
      : [];

  const students: WithId<UserDoc>[] =
    studentsResult.status === "fulfilled" ? studentsResult.value : [];

  return (
    <ExamDetailView
      exam={serializeDoc(exam)}
      attempts={serializeDocs(attempts)}
      students={serializeDocs(students)}
      basePath="/teacher"
    />
  );
}
