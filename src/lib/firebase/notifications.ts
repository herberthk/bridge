"use client";

import {
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type QuerySnapshot,
} from "firebase/firestore";
import type { FirestoreDataConverter } from "firebase/firestore";

import { dbClient } from "@/lib/firebase/client";
import type { NotificationDoc, NotificationType } from "@/types/firestore";
import type { WithId } from "@/types/firestore";

/**
 * Client-side notifications: live subscription for the bell, mark-as-read and
 * mark-all-read. Firestore rules restrict every read/write to the signed-in
 * recipient; creation is server-only.
 */

const converter: FirestoreDataConverter<NotificationDoc> = {
  toFirestore(data: NotificationDoc) {
    return data;
  },
  fromFirestore(snap) {
    return snap.data() as NotificationDoc;
  },
};

function notificationsRef() {
  return collection(dbClient(), "notifications").withConverter(converter);
}

export interface UnreadBadge {
  count: number;
  /** True when the unread count hit the subscription cap (display "25+"). */
  capped: boolean;
}

const UNREAD_CAP = 25;

/** Live unread count for the bell badge (capped to keep the listener cheap). */
export function subscribeUnreadCount(
  uid: string,
  onChange: (badge: UnreadBadge) => void,
): () => void {
  const q = query(
    notificationsRef(),
    where("userId", "==", uid),
    where("read", "==", false),
    orderBy("createdAt", "desc"),
    fsLimit(UNREAD_CAP),
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot<NotificationDoc>) => {
      onChange({ count: snap.size, capped: snap.size >= UNREAD_CAP });
    },
    (err) => console.error("[notifications] unread listener failed", err),
  );
}

/** Recent notifications for the bell dropdown / notifications page. */
export function subscribeRecentNotifications(
  uid: string,
  max: number,
  onChange: (items: WithId<NotificationDoc>[]) => void,
): () => void {
  const q = query(
    notificationsRef(),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    fsLimit(max),
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot<NotificationDoc>) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => console.error("[notifications] list listener failed", err),
  );
}

/** Older notifications, one page at a time (notifications page "load more"). */
export async function fetchOlderNotifications(
  uid: string,
  beforeIso: string,
  max: number,
): Promise<WithId<NotificationDoc>[]> {
  const q = query(
    notificationsRef(),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    // Client Timestamp accepts ISO strings for range comparisons on the wire.
    where("createdAt", "<", new Date(beforeIso)),
    fsLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Mark one notification read (rules limit updates to read/readAt/updatedAt). */
export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(notificationsRef(), id), {
    read: true,
    readAt: new Date(),
    updatedAt: new Date(),
  }).catch((err) => console.error("[notifications] mark read failed", err));
}

/** Mark every unread notification (up to 450) as read. */
export async function markAllNotificationsRead(uid: string): Promise<void> {
  const q = query(
    notificationsRef(),
    where("userId", "==", uid),
    where("read", "==", false),
    fsLimit(450),
  );
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(dbClient());
  snap.docs.forEach((d) =>
    batch.update(d.ref, { read: true, readAt: new Date(), updatedAt: new Date() }),
  );
  await batch.commit().catch((err) => console.error("[notifications] mark all failed", err));
}

/** Icon key per notification type — the bell UI maps this to a lucide icon. */
export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  exam_assigned: "exam",
  retake_approved: "approved",
  retake_rejected: "rejected",
  results_ready: "results",
  exam_submitted: "submitted",
  retake_requested: "requested",
};
