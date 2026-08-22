export const dynamic = "force-dynamic";

import { usersCol } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import { listSchools } from "@/server/services/schools";
import { SchoolsManager } from "@/components/features/super/schools-manager";
import type { WithId, SchoolDoc, UserDoc } from "@/types/firestore";

export default async function SuperSchoolsPage() {
  await requireRole("super_admin");

  let schools: WithId<SchoolDoc>[] = [];
  let standaloneAdmins: WithId<UserDoc>[] = [];
  try {
    [schools, standaloneAdmins] = await Promise.all([
      listSchools(),
      usersCol()
        .where("role", "==", "admin")
        .where("schoolId", "==", null)
        .limit(200)
        .get()
        .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data()! }))),
    ]);
  } catch (err) {
    console.error("[super/schools] load failed", err);
  }

  return <SchoolsManager schools={schools} standaloneAdmins={standaloneAdmins} />;
}
