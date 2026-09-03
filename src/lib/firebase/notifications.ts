"use client";

import {
  collection,
  doc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import type { FirestoreDataConverter } from "firebase/firestore";

import { dbClient } from "@/lib/firebase/client";
import type { NotificationDoc, NotificationType } from "@/types/firestore";
import type { WithId } from "@/types/firestore";

export type NotificationItem = WithId<NotificationDoc> & {
  snapshot: QueryDocumentSnapshot<NotificationDoc>;
};

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
  onChange: (items: NotificationItem[]) => void,
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
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data(), snapshot: d })));
    },
    (err) => console.error("[notifications] list listener failed", err),
  );
}

/** Older notifications, one page at a time (notifications page "load more"). */
export async function fetchOlderNotifications(
  uid: string,
  cursor: QueryDocumentSnapshot<NotificationDoc>,
  max: number,
): Promise<NotificationItem[]> {
  const q = query(
    notificationsRef(),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    startAfter(cursor),
    fsLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), snapshot: d }));
}

/** Mark one notification read (rules limit updates to read/readAt/updatedAt). */
export async function markNotificationRead(id: string): Promise<void> {
  try {
    await updateDoc(doc(notificationsRef(), id), {
      read: true,
      readAt: new Date(),
      updatedAt: new Date(),
    });
  } catch (err) {
    console.error("[notifications] mark read failed", err);
    throw err;
  }
}

/** Mark every unread notification as read in cursor-paginated batches. */
export async function markAllNotificationsRead(uid: string): Promise<void> {
  let cursor: QueryDocumentSnapshot<NotificationDoc> | null = null;

  try {
    while (true) {
      const baseConstraints = [
        where("userId", "==", uid),
        where("read", "==", false),
        orderBy("createdAt", "desc"),
      ];
      const pageQuery: Query<NotificationDoc> = query(
        notificationsRef(),
        ...baseConstraints,
        ...(cursor ? [startAfter(cursor)] : []),
        fsLimit(450),
      );
      const snap = await getDocs(pageQuery);
      if (snap.empty) {
        const remaining = await getDocs(
          query(notificationsRef(), ...baseConstraints, fsLimit(1)),
        );
        if (remaining.empty) return;
        cursor = null;
        continue;
      }

      const batch = writeBatch(dbClient());
      const now = new Date();
      snap.docs.forEach((d) =>
        batch.update(d.ref, { read: true, readAt: now, updatedAt: now }),
      );
      await batch.commit();

      if (snap.size === 450) {
        cursor = snap.docs.at(-1) ?? null;
      } else {
        const remaining = await getDocs(
          query(notificationsRef(), ...baseConstraints, fsLimit(1)),
        );
        if (remaining.empty) return;
        cursor = null;
      }
    }
  } catch (err) {
    console.error("[notifications] mark all failed", err);
    throw err;
  }
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
