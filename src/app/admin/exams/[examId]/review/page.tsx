export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { getExamForReview } from "@/server/services/exam-review";
import { listStudents } from "@/server/services/users";
import { ExamReviewWorkspace } from "@/components/features/admin/exam-review";
import { Button } from "@/components/ui/button";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { UserDoc, WithId } from "@/types/firestore";

/**
 * Review every question in an exam, revise what needs revising, then assign.
 *
 * A route of its own rather than a mode of the library or the generator: reviewing
 * a 60-question paper is a sitting, not a step, and a deep link is what lets it be
 * picked up tomorrow — or handed to the colleague who teaches the class.
 *
 * The shell is server-rendered so the questions arrive with the document instead of
 * after a client fetch. Only the workspace below is interactive.
 */
export default async function AdminExamReviewPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const actor = await requireRole("admin");

  let exam: Awaited<ReturnType<typeof getExamForReview>> | null = null;
  try {
    exam = await getExamForReview(actor, examId);
  } catch {
    notFound();
  }
  if (!exam) notFound();

  // Loaded here so the assign dialog opens without a round trip — the whole point
  // of the review screen is to finish at "assigned". A failure to list students
  // must not take the review surface with it, hence the empty fallback.
  let students: WithId<UserDoc>[] = [];
  try {
    students = await listStudents(actor);
  } catch (err) {
    console.error("[admin/exams/review] student load failed", err);
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="self-start"
        render={<Link href="/admin/exams" />}
      >
        <ArrowLeftIcon data-icon="inline-start" /> Back to library
      </Button>

      <ExamReviewWorkspace exam={serializeDoc(exam)} students={serializeDocs(students)} />
    </div>
  );
}
