import type { Metadata } from "next";

import { requireActiveUser } from "@/server/auth/session";
import { NotificationsView } from "@/components/features/notifications/notifications-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Notifications — Bridge" };

/** In-app notification center — every signed-in role can read their own. */
export default async function NotificationsPage() {
  await requireActiveUser();
  return <NotificationsView />;
}
