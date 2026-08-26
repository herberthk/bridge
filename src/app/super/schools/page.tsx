export const dynamic = "force-dynamic";

import { countQuery, usersCol } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import { countSchools, listSchools } from "@/server/services/schools";
import { SchoolsManager } from "@/components/features/super/schools-manager";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, SchoolDoc, UserDoc } from "@/types/firestore";

const SCHOOLS_CAP = 500;
const ADMINS_CAP = 200;

export default async function SuperSchoolsPage() {
  await requireRole("super_admin");

  let schools: WithId<SchoolDoc>[] = [];
  let standaloneAdmins: WithId<UserDoc>[] = [];
  let totalSchools = 0;
  let totalStandaloneAdmins = 0;
  try {
    [schools, standaloneAdmins, totalSchools, totalStandaloneAdmins] = await Promise.all([
      listSchools(SCHOOLS_CAP),
      usersCol()
        .where("role", "==", "admin")
        .where("schoolId", "==", null)
        .limit(ADMINS_CAP)
        .get()
        .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data()! }))),
      countSchools(),
      countQuery(
        usersCol().where("role", "==", "admin").where("schoolId", "==", null),
      ),
    ]);
  } catch (err) {
    console.error("[super/schools] load failed", err);
  }

  return (
    <SchoolsManager
      schools={serializeDocs(schools)}
      standaloneAdmins={serializeDocs(standaloneAdmins)}
      totals={{
        schools: totalSchools,
        schoolsTruncated: totalSchools > schools.length,
        standaloneAdmins: totalStandaloneAdmins,
        adminsTruncated: totalStandaloneAdmins > standaloneAdmins.length,
      }}
    />
  );
}
