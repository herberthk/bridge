import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireRole } from "@/server/auth/session";
import { getSchoolById } from "@/server/services/schools";
import { SchoolProfileView } from "@/components/features/school/school-profile-view";
import { serializeDoc } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "School Profile | Bridge Admin",
  description:
    "Manage public school details and request blue-tick verification.",
};

export default async function AdminSchoolPage() {
  const actor = await requireRole("admin");
  if (!actor.schoolId) redirect("/admin");

  const school = await getSchoolById(actor.schoolId);
  return <SchoolProfileView school={serializeDoc(school)} />;
}
