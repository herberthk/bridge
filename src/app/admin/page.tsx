import type { Metadata } from "next";

import { requireRole } from "@/server/auth/session";
import { adminDashboard } from "@/server/services/analytics";
import { AdminDashboardView } from "@/components/features/admin/admin-dashboard-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Command Center | Bridge Admin",
  description:
    "Real-time analytics on assessments, exam trends, retakes and AI token usage.",
};

export default async function AdminHomePage() {
  const actor = await requireRole("admin");

  let data: Awaited<ReturnType<typeof adminDashboard>> | null = null;
  let loadFailed = false;

  try {
    data = await adminDashboard(actor);
  } catch (err) {
    console.error("[admin dashboard] load failed", err);
    loadFailed = true;
  }

  return (
    <AdminDashboardView
      data={data}
      actor={{
        uid: actor.uid,
        displayName: actor.displayName,
        email: actor.email,
        role: actor.role,
        schoolId: actor.schoolId,
      }}
      loadFailed={loadFailed}
    />
  );
}
