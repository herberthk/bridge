import { ExamGenerator } from "@/components/features/admin/exam-generator";

export const dynamic = "force-dynamic";

/** Teacher exam generation — the API enforces role, class and wallet checks. */
export default function TeacherGeneratePage() {
  return <ExamGenerator />;
}
