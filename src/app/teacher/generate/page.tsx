import { redirect } from "next/navigation";

import { ExamGenerator } from "@/components/features/admin/exam-generator";
import { requireRole } from "@/server/auth/session";
import { getClassForActor } from "@/server/services/classes";

export const dynamic = "force-dynamic";

/**
 * Teacher exam generation — always inside a class. The wizard pre-fills and
 * locks level/year from the class; the API enforces role, class and wallet
 * checks. Landing here without a class (bookmark, old link) bounces to the
 * class list to pick one first.
 */
export default async function TeacherGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string | string[] }>;
}) {
  const actor = await requireRole("teacher");
  const { classId } = await searchParams;
  const id = Array.isArray(classId) ? classId[0] : classId;
  if (!id) redirect("/teacher/classes");
  let classScope: Awaited<ReturnType<typeof getClassForActor>>;
  try {
    classScope = await getClassForActor(actor, id);
  } catch {
    redirect("/teacher/classes");
  }
  return (
    <ExamGenerator
      key={classScope.id}
      classScope={{
        id: classScope.id,
        name: classScope.name,
        level: classScope.level,
        secondarySubLevel: classScope.secondarySubLevel,
        classLevel: classScope.classLevel,
      }}
    />
  );
}
