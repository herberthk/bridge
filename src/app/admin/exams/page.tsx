export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listExams } from "@/server/services/exams";
import { listStudents } from "@/server/services/users";
import { ExamLibrary } from "@/components/features/admin/exam-library";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, ExamDoc, UserDoc } from "@/types/firestore";

export default async function AdminExamsPage() {
  const actor = await requireRole("admin");

  let exams: WithId<ExamDoc>[] = [];
  let students: WithId<UserDoc>[] = [];
  try {
    [exams, students] = await Promise.all([
      listExams(actor),
      listStudents(actor),
    ]);
  } catch (err) {
    console.error("[admin/exams] load failed", err);
  }

  return <ExamLibrary exams={serializeDocs(exams)} students={serializeDocs(students)} />;
}
