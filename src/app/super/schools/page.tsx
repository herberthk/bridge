export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listPlatformSchools } from "@/server/services/platform";
import { countQuery, usersCol } from "@/server/firebase/collections";
import {
  CreateSchoolDialog,
  CreateStandaloneAdminDialog,
} from "@/components/features/super/schools-manager";
import { SchoolsDirectory, SchoolsToolbar } from "@/components/features/super/schools-directory";
import { Pagination } from "@/components/features/super/pagination";
import { serializeDocs } from "@/lib/serialize";

const PAGE_SIZE = 10;

export default async function SuperSchoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; level?: string; verification?: string; page?: string }>;
}) {
  const actor = await requireRole("super_admin");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [result, standaloneAdmins] = await Promise.all([
    listPlatformSchools(actor, {
      search: params.q ?? null,
      level: params.level ?? null,
      verification: params.verification ?? null,
      page,
      pageSize: PAGE_SIZE,
    }),
    usersCol()
      .where("role", "==", "admin")
      .where("schoolId", "==", null)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get()
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data()! })))
      .catch(() => []),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schools &amp; admins</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {result.total} school{result.total === 1 ? "" : "s"} registered · {standaloneAdmins.length}{" "}
            standalone admin{standaloneAdmins.length === 1 ? "" : "s"} · click a school for the full
            picture.
          </p>
        </div>
        <div className="flex gap-2">
          <CreateStandaloneAdminDialog />
          <CreateSchoolDialog />
        </div>
      </div>

      <SchoolsToolbar />

      <SchoolsDirectory result={{ ...result, items: serializeDocs(result.items) }} />
      <Pagination page={result.page} totalPages={result.totalPages} />

      {standaloneAdmins.length > 0 && (
        <div className="shadow-card rounded-xl border bg-card">
          <div className="border-b px-6 py-4">
            <p className="text-sm font-semibold">Standalone admins</p>
            <p className="text-muted-foreground text-xs">
              Parents and tutors billing on personal wallets — no school attached.
            </p>
          </div>
          <div className="divide-y">
            {standaloneAdmins.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{a.displayName}</span>
                  <span className="text-muted-foreground text-xs">{a.email}</span>
                </div>
                <span className="text-muted-foreground text-xs capitalize">{a.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
