export const dynamic = "force-dynamic";

import { serializeDocs } from "@/lib/serialize";
import { requireRole } from "@/server/auth/session";
import { listPlatformSchoolOptions, listPlatformUsers } from "@/server/services/platform";
import { StudentsDirectory } from "@/components/features/super/students-directory";
import { normalizeDirectorySchool, normalizeDirectoryStatus } from "@/lib/directory-filters";

const PAGE_SIZE = 10;

export default async function SuperStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; school?: string; status?: string; page?: string }>;
}) {
  const actor = await requireRole("super_admin");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const schools = await listPlatformSchoolOptions(actor);
  const result = await listPlatformUsers(actor, {
    role: "student",
    search: params.q ?? null,
    schoolId: normalizeDirectorySchool(params.school, schools),
    status: normalizeDirectoryStatus(params.status),
    page,
    pageSize: PAGE_SIZE,
  });

  const schoolNames: Record<string, string> = {};
  schools.forEach((s) => {
    schoolNames[s.id] = s.name;
  });

  const paged = { ...result, items: serializeDocs(result.items) };

  return (
    <StudentsDirectory
      result={paged}
      schools={schools}
      schoolNames={schoolNames}
    />
  );
}
