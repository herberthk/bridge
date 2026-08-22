export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getAttemptDetail, AttemptsServiceError } from "@/server/services/attempts";
import { ExamRunner } from "@/components/features/exam/exam-runner";

export const metadata = { title: "Exam session" };

export default async function ExamRunnerPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await requireRole("student");

  let attempt = null;
  let exam = null;
  try {
    ({ attempt, exam } = await getAttemptDetail(user, attemptId));
  } catch (err) {
    if (err instanceof AttemptsServiceError && err.status === 404) notFound();
    if (err instanceof AttemptsServiceError && err.status === 403) redirect("/student");
    throw err;
  }

  if (
    attempt.status === "submitted" ||
    attempt.status === "graded" ||
    attempt.status === "flagged"
  ) {
    redirect(`/student/results/${attemptId}`);
  }

  return (
    <ExamRunner
      attemptId={attemptId}
      examTitle={exam?.title ?? "Exam"}
      durationMinutes={exam?.params.durationMinutes ?? 45}
      questionCount={exam?.questions.length ?? 0}
    />
  );
}
