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

  if (!exam) notFound();
  if (typeof exam.params.durationMinutes !== "number") {
    throw new Error("Exam duration not configured — admin must set duration when generating the exam.");
  }

  const policy = {
    preventBacktrack: (exam?.params as unknown as { preventBacktrack?: boolean } | undefined)?.preventBacktrack ?? true,
    allowReviewBeforeSubmit: (exam?.params as unknown as { allowReviewBeforeSubmit?: boolean } | undefined)?.allowReviewBeforeSubmit ?? false,
    allowSkipping: (exam?.params as unknown as { allowSkipping?: boolean } | undefined)?.allowSkipping ?? true,
    requireFullscreen: (exam?.params as unknown as { requireFullscreen?: boolean } | undefined)?.requireFullscreen ?? true,
    enableCameraRecording: (exam?.params as unknown as { enableCameraRecording?: boolean } | undefined)?.enableCameraRecording ?? false,
    enableScreenRecording: (exam?.params as unknown as { enableScreenRecording?: boolean } | undefined)?.enableScreenRecording ?? false,
  };

  return (
    <ExamRunner
      attemptId={attemptId}
      examTitle={exam.title}
      durationMinutes={exam.params.durationMinutes}
      questionCount={exam.questions.length}
      policy={policy}
    />
  );
}
