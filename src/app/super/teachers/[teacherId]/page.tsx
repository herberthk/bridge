export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getSuperTeacherDetail } from "@/server/services/platform";
import { SuperTeacherDetailView } from "@/components/features/super/teacher-detail-view";
import { serializeDoc, serializeDocs } from "@/lib/serialize";

export default async function SuperTeacherDetailPage({
  params,
}: {
  params: Promise<{ teacherId: string }>;
}) {
  const { teacherId } = await params;
  const actor = await requireRole("super_admin");

  let detail: Awaited<ReturnType<typeof getSuperTeacherDetail>> | null = null;
  try {
    detail = await getSuperTeacherDetail(actor, teacherId);
  } catch {
    notFound();
  }
  if (!detail) notFound();

  return (
    <SuperTeacherDetailView
      teacher={serializeDoc(detail.teacher)}
      school={detail.school ? serializeDoc(detail.school) : null}
      classes={serializeDocs(detail.classes)}
      studentsReached={detail.studentsReached}
      examsGenerated={detail.examsGenerated}
    />
  );
}
