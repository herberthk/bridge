export const dynamic = "force-dynamic";

import { serializeDoc, serializeDocs } from "@/lib/serialize";
import { requireRole } from "@/server/auth/session";
import { listPlatformSchools, listPlatformUsers } from "@/server/services/platform";
import { StudentsDirectory } from "@/components/features/super/students-directory";

const PAGE_SIZE = 20;

export default async function SuperStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; school?: string; status?: string; page?: string }>;
}) {
  const actor = await requireRole("super_admin");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [result, schoolsResult] = await Promise.all([
    listPlatformUsers(actor, {
      role: "student",
      search: params.q ?? null,
      schoolId: params.school ?? null,
      status: params.status ?? null,
      page,
      pageSize: PAGE_SIZE,
    }),
    listPlatformSchools(actor, { page: 1, pageSize: 100 }),
  ]);

  const schoolNames: Record<string, string> = {};
  schoolsResult.items.forEach((s) => {
    schoolNames[s.id] = s.name;
  });

  const paged = { ...result, items: serializeDocs(result.items) };

  return (
    <StudentsDirectory
      result={paged}
      schools={schoolsResult.items.map((s) => ({ id: s.id, name: s.name }))}
      schoolNames={schoolNames}
    />
  );
}
