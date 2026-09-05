export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getAttemptDetail, AttemptsServiceError } from "@/server/services/attempts";
import { hasOpenRetakeAttempt, hasPendingRetakeRequest } from "@/server/services/retakes";
import { ResultsView } from "@/components/features/student/results-view";
import { serializeDoc } from "@/lib/serialize";
import type { WithId, AttemptDoc, ExamDoc } from "@/types/firestore";

/**
 * Static metadata on purpose: a `generateMetadata` here would re-run
 * `getAttemptDetail` (Admin SDK, no request dedupe) and double the Firestore
 * reads for zero benefit — the exam title renders in the client hero anyway.
 */
export const metadata = { title: "Results • Bridge" };

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const user = await requireRole("student");

  // Single critical fetch first, then the two lightweight retake flags in
  // parallel — the hero streams as soon as attempt+exam resolve.
  let data: { attempt: WithId<AttemptDoc>; exam: WithId<ExamDoc> | null } | null = null;
  try {
    data = await getAttemptDetail(user, attemptId);
  } catch (err) {
    if (err instanceof AttemptsServiceError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  if (!data) notFound();

  const { attempt, exam } = data;

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
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Ambient page glow — pure CSS, zero JS, paints once behind the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-72">
        <div className="bg-mesh absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>

      <ResultsView
        attempt={serializeDoc(attempt)}
        exam={exam ? serializeDoc(exam) : null}
        hasPendingRequest={hasPending}
        hasOpenRetake={hasOpenRetake}
      />
    </div>
  );
}
