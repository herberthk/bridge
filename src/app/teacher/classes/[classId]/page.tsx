export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireRole, type SessionUser } from "@/server/auth/session";
import { ClassesServiceError } from "@/server/services/classes";
import {
  getClassDashboardBundle,
  type ClassDashboardBundle,
} from "@/server/services/leaderboard";
import { listRecentExamsForClasses } from "@/server/services/exams";
import { getSchoolById } from "@/server/services/schools";
import { listSchoolStaff } from "@/server/services/users";
import { ClassDashboardView } from "@/components/features/school/class-dashboard-view";
import { ClassDetailSkeleton } from "@/components/features/dashboard/skeletons";
import { isMissingIndexError } from "@/lib/firestore-errors";
import type { ClassPerformanceStats } from "@/lib/leaderboard";
import { serializeDoc, serializeDocs } from "@/lib/serialize";
import type { ExamDoc, UserDoc, WithId } from "@/types/firestore";

/* ── Error visibility ────────────────────────────────────────────────
 * Auth/unknown-class errors become 404 (mirrors the pre-bundle pages, and
 * avoids leaking class existence). A failed roster read fails loud — never
 * render "No students yet" for a backend failure. Firestore missing-index
 * errors (FAILED_PRECONDITION, code 9) carry the console link to create the
 * index — check server logs, don't trust empty UI. */
function logDashboardError(
  scope: string,
  actor: SessionUser,
  classId: string,
  err: unknown,
): void {
  console.error(`[classes] ${scope} failed`, {
    actorId: actor.uid,
    actorRole: actor.role,
    schoolId: actor.schoolId ?? null,
    classId,
    missingIndex: isMissingIndexError(err),
    error: err,
  });
}

/** Teacher view of one class — streams in behind the skeleton. */
export default async function TeacherClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const actor = await requireRole("teacher");

  return (
    <Suspense fallback={<ClassDetailSkeleton />}>
      <ClassBody actor={actor} classId={classId} />
    </Suspense>
  );
}

/* ── Class dashboard (streams in) ────────────────────────────────────
 * One bundle call covers roster + leaderboard + performance (a single roster
 * read and a single attempts fan-out); school/staff context and the class's
 * recent exams load alongside. */
async function ClassBody({ actor, classId }: { actor: SessionUser; classId: string }) {
  const [bundle, school, staff, recentExams] = await Promise.all([
    getClassDashboardBundle(actor, classId).catch((err: unknown): ClassDashboardBundle => {
      if (err instanceof ClassesServiceError) notFound();
      logDashboardError("classDashboard", actor, classId, err);
      throw err;
    }),
    actor.schoolId
      ? getSchoolById(actor.schoolId).catch((err: unknown) => {
          logDashboardError("getSchoolById", actor, classId, err);
          return null;
        })
      : Promise.resolve(null),
    listSchoolStaff(actor).catch((err: unknown) => {
      logDashboardError("listSchoolStaff", actor, classId, err);
      return { admins: [] as WithId<UserDoc>[], teachers: [] as WithId<UserDoc>[] };
    }),
    listRecentExamsForClasses(actor, [classId], 8)
      .then((r) => ({ ...r, failed: false as const }))
      .catch((err: unknown) => {
        logDashboardError("listRecentExamsForClasses", actor, classId, err);
        return { exams: [] as WithId<ExamDoc>[], partial: false, failed: true as const };
      }),
  ]);

  const leaderboard = bundle.leaderboard?.entries ?? [];
  const stats: ClassPerformanceStats = bundle.leaderboard?.stats ?? {
    students: bundle.studentCount,
    gradedAttempts: 0,
    averagePercentage: null,
    participationRate: 0,
    topPercentage: null,
  };

  return (
    <ClassDashboardView
      cls={serializeDoc(bundle.cls)}
      basePath="/teacher"
      students={serializeDocs(bundle.students)}
      studentCount={bundle.studentCount}
      leaderboard={leaderboard}
      stats={stats}
      examPerformance={bundle.performance}
      classExams={serializeDocs(recentExams.exams)}
      canManage
      schoolName={school?.name ?? null}
      schoolVerification={school?.verification ?? null}
      teacherNames={[...staff.admins, ...staff.teachers]
        .filter((t) => (bundle.cls.teacherIds ?? []).includes(t.id))
        .map((t) => t.displayName)}
      cachedStudentCount={bundle.cls.studentCount}
      degraded={recentExams.failed ? [...bundle.degraded, "Exams"] : bundle.degraded}
      examsPartial={recentExams.partial}
    />
  );
}
