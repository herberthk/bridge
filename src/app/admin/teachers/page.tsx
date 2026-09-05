import type { Metadata } from "next";
import { UsersRoundIcon } from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { listClasses } from "@/server/services/classes";
import { listInvites } from "@/server/services/invites";
import { getSchoolById } from "@/server/services/schools";
import { listTeachers } from "@/server/services/users";
import { TeachersManager } from "@/components/features/school/teachers-manager";
import { InviteTeacherDialog } from "@/components/features/school/invite-teacher-dialog";
import { AdminPageHeader } from "@/components/features/admin/admin-page-header";
import { serializeDocs } from "@/lib/serialize";
import type { WithId, UserDoc } from "@/types/firestore";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Teachers | Bridge Admin",
  description: "Invite teachers and manage the classes each teacher oversees.",
};

export default async function AdminTeachersPage() {
  const actor = await requireRole("admin");
  const schoolId = actor.schoolId;

  const [classes, teachers, invites, school] = await Promise.all([
    listClasses(actor),
    schoolId ? listTeachers(schoolId) : Promise.resolve([] as WithId<UserDoc>[]),
    listInvites(actor).catch(() => []),
    schoolId ? getSchoolById(schoolId).catch(() => null) : Promise.resolve(null),
  ]);

  const pendingInvites = invites.filter((i) => i.status === "pending");
  const schoolName = school?.name ?? "your school";

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        icon={<UsersRoundIcon className="size-5" />}
        eyebrow="Team management"
        title="Teachers"
        description={`Everyone teaching at ${schoolName} — invite teachers, track pending invites, and assign the classes each teacher manages.`}
        meta={`${teachers.length} active · ${pendingInvites.length} pending · ${classes.length} classes`}
        actions={<InviteTeacherDialog classes={serializeDocs(classes)} />}
      />

      <TeachersManager
        teachers={serializeDocs(teachers)}
        classes={serializeDocs(classes)}
        pendingInvites={serializeDocs(pendingInvites)}
        schoolName={schoolName}
      />
    </div>
  );
}
