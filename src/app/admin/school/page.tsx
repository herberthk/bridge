export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getSchoolById } from "@/server/services/schools";
import { SchoolProfileView } from "@/components/features/school/school-profile-view";
import { serializeDoc } from "@/lib/serialize";

export default async function AdminSchoolPage() {
  const actor = await requireRole("admin");
  if (!actor.schoolId) redirect("/admin");

  const school = await getSchoolById(actor.schoolId);
  return <SchoolProfileView school={serializeDoc(school)} />;
}
