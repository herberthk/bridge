export const dynamic = "force-dynamic";

import { format } from "date-fns";

import { requireRole } from "@/server/auth/session";
import { studentDashboard } from "@/server/services/analytics";
import { listStudentAttempts } from "@/server/services/attempts";
import { getStudentClassStanding } from "@/server/services/leaderboard";
import { listStudentRetakeRequests } from "@/server/services/retakes";
import { StudentDashboard } from "@/components/features/student/student-dashboard";
import { withTimeout } from "@/lib/promise";

export const metadata = { title: "Dashboard • Bridge" };

/**
 * Bound one parallel round so a slow or non-settling source degrades its
 * sections instead of blocking the whole page; each source still fails
 * independently via allSettled. Class standing follows only if cheaply
 * resolvable.
 */
const SOURCE_TIMEOUT_MS = 10_000;

export default async function StudentHomePage() {
  const actor = await requireRole("student");

  const [dashboardRes, attemptsRes, requestsRes] = await Promise.allSettled([
    withTimeout(studentDashboard(actor), SOURCE_TIMEOUT_MS, "[student dashboard] dashboard"),
    withTimeout(listStudentAttempts(actor), SOURCE_TIMEOUT_MS, "[student dashboard] attempts"),
    withTimeout(
      listStudentRetakeRequests(actor),
      SOURCE_TIMEOUT_MS,
      "[student dashboard] retake requests",
    ),
  ]);

  const data = dashboardRes.status === "fulfilled" ? dashboardRes.value : null;
  const attempts = attemptsRes.status === "fulfilled" ? attemptsRes.value : [];
  const attemptsAvailable = attemptsRes.status === "fulfilled";
  const requests = requestsRes.status === "fulfilled" ? requestsRes.value : [];
  for (const res of [dashboardRes, attemptsRes, requestsRes]) {
    if (res.status === "rejected") console.error("[student dashboard] load failed", res.reason);
  }

  let standing: Awaited<ReturnType<typeof getStudentClassStanding>> = null;
  try {
    standing = await getStudentClassStanding(actor);
  } catch (err) {
    console.error("[student dashboard] standing failed", err);
    standing = null;
  }

  const degraded =
    dashboardRes.status === "rejected" ||
    attemptsRes.status === "rejected" ||
    requestsRes.status === "rejected";

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-col">
      {/* Ambient page glow — pure CSS, zero JS, paints once behind the header. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-72">
        <div className="bg-mesh absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>

      <StudentDashboard
        firstName={actor.displayName.split(" ")[0] || "there"}
        todayLabel={format(new Date(), "EEEE, d MMMM yyyy")}
        data={data}
        attempts={attempts}
        attemptsAvailable={attemptsAvailable}
        requests={requests}
        standing={standing}
        degraded={degraded}
      />
    </div>
  );
}
