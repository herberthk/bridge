export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getSuperStudentDetail, PlatformServiceError } from "@/server/services/platform";
import { SuperStudentDetailView } from "@/components/features/super/student-detail-view";
import { serializeDoc } from "@/lib/serialize";

export default async function SuperStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const actor = await requireRole("super_admin");

  let detail: Awaited<ReturnType<typeof getSuperStudentDetail>> | null = null;
  try {
    detail = await getSuperStudentDetail(actor, studentId);
  } catch (err) {
    if (err instanceof PlatformServiceError && err.status === 404) notFound();
    throw err;
  }
  if (!detail) notFound();

  return (
    <SuperStudentDetailView
      student={serializeDoc(detail.student)}
      school={detail.school ? serializeDoc(detail.school) : null}
      classInfo={detail.classInfo ? serializeDoc(detail.classInfo) : null}
      attempts={detail.attempts.map(({ attempt, examTitle }) => ({
        attempt: serializeDoc(attempt),
        examTitle,
      }))}
      stats={detail.stats}
    />
  );
}
