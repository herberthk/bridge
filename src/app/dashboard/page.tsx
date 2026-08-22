import { redirect } from "next/navigation";

import { requireUser, roleHome } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Role-aware entry point: bounces each user to their home dashboard. */
export default async function DashboardPage() {
  const user = await requireUser();
  if (user.status === "banned") redirect("/banned");
  if (user.status === "suspended") redirect("/suspended");
  redirect(roleHome(user.role));
}
