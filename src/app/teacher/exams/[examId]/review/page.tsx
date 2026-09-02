export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getExamForReview } from "@/server/services/exam-review";
import { getAssignedStudentIdsForExam } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { ExamReviewWorkspace } from "@/components/features/admin/exam-review";
import { Button } from "@/components/ui/button";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { UserDoc, WithId } from "@/types/firestore";

export default async function TeacherExamReviewPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const actor = await requireRole("teacher");

  let exam: Awaited<ReturnType<typeof getExamForReview>> | null = null;
  try {
    exam = await getExamForReview(actor, examId);
  } catch {
    notFound();
  }
  if (!exam) notFound();

  const [studentsResult, assignedResult] = await Promise.allSettled([
    listStudents(actor).catch(() => [] as WithId<UserDoc>[]),
    getAssignedStudentIdsForExam(actor, examId).catch(() => [] as string[]),
  ]);

  const students: WithId<UserDoc>[] =
    studentsResult.status === "fulfilled" ? studentsResult.value : [];
  const assignedStudentIds: string[] =
    assignedResult.status === "fulfilled" ? assignedResult.value : [];

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="self-start"
        render={<Link href="/teacher/exams" />}
      >
        <ArrowLeftIcon data-icon="inline-start" /> Back to library
      </Button>

      <ExamReviewWorkspace
        exam={serializeDoc(exam)}
        students={serializeDocs(students)}
        assignedStudentIds={assignedStudentIds}
        basePath="/teacher"
      />
    </div>
  );
}
