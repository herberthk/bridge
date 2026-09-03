export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getSuperSchoolDetail, PlatformServiceError } from "@/server/services/platform";
import { SuperSchoolDetailView } from "@/components/features/super/school-detail-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";

export default async function SuperSchoolDetailPage({
  params,
}: {
  params: Promise<{ schoolId: string }>;
}) {
  const { schoolId } = await params;
  const actor = await requireRole("super_admin");

  let detail: Awaited<ReturnType<typeof getSuperSchoolDetail>> | null = null;
  try {
    detail = await getSuperSchoolDetail(actor, schoolId);
  } catch (err) {
    if (err instanceof PlatformServiceError && err.status === 404) notFound();
    throw err;
  }
  if (!detail) notFound();

  return (
    <SuperSchoolDetailView
      school={serializeDoc(detail.school)}
      admins={serializeDocs(detail.admins)}
      teachers={serializeDocs(detail.teachers)}
      students={serializeDocs(detail.students)}
      wallet={detail.wallet ? serializeDoc(detail.wallet) : null}
      examCount={detail.examCount}
      attemptCount={detail.attemptCount}
    />
  );
}
