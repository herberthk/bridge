export const dynamic = "force-dynamic";

import { requireRole } from "@/server/auth/session";
import { listClasses } from "@/server/services/classes";
import { listInvites } from "@/server/services/invites";
import { getSchoolById } from "@/server/services/schools";
import { listTeachers } from "@/server/services/users";
import { TeachersManager } from "@/components/features/school/teachers-manager";
import { InviteTeacherDialog } from "@/components/features/school/invite-teacher-dialog";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { WithId, UserDoc } from "@/types/firestore";

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Invite teachers to your school and assign the classes they manage.
          </p>
        </div>
        <InviteTeacherDialog classes={serializeDocs(classes)} />
      </div>

      <TeachersManager
        teachers={serializeDocs(teachers)}
        classes={serializeDocs(classes)}
        pendingInvites={serializeDocs(pendingInvites)}
        schoolName={school?.name ?? "your school"}
      />
    </div>
  );
}
