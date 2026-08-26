import { redirect } from "next/navigation";

import { requireActiveUser, roleHome } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Role-aware entry point: bounces each user to their home dashboard. */
export default async function DashboardPage() {
  const user = await requireActiveUser();
  redirect(roleHome(user.role));
}
