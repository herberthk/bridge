export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getAttemptDetail, AttemptsServiceError } from "@/server/services/attempts";
import { hasOpenRetakeAttempt, hasPendingRetakeRequest } from "@/server/services/retakes";
import { ResultsView } from "@/components/features/student/results-view";
import { serializeDoc } from "@/lib/serialize";
import type { WithId, AttemptDoc, ExamDoc } from "@/types/firestore";

export const metadata = { title: "Results" };

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await requireRole("student");

  let data: { attempt: WithId<AttemptDoc>; exam: WithId<ExamDoc> | null } | null = null;
  try {
    data = await getAttemptDetail(user, attemptId);
  } catch (err) {
    if (err instanceof AttemptsServiceError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  let hasPending = false;
  let hasOpenRetake = false;
  try {
    [hasPending, hasOpenRetake] = await Promise.all([
      hasPendingRetakeRequest(attemptId, user.uid),
      hasOpenRetakeAttempt(attemptId, user.uid),
    ]);
  } catch {
    hasPending = false;
    hasOpenRetake = false;
  }

  return (
    <ResultsView
      attempt={serializeDoc(data.attempt)}
      exam={data.exam ? serializeDoc(data.exam) : null}
      hasPendingRequest={hasPending}
      hasOpenRetake={hasOpenRetake}
    />
  );
}
