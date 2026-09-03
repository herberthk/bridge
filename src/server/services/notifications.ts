import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  classDoc,
  notificationsCol,
  userDoc,
  usersCol,
} from "@/server/firebase/collections";
import type { NotificationDoc, NotificationType, WithId, WriteModel } from "@/types/firestore";
import { dedupeIds } from "@/lib/pagination";

export class NotificationsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/** Firestore batches cap at 500 writes — stay under it. */
const BATCH_SIZE = 450;

interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  /** In-app deep link the recipient opens. */
  link: string;
  /** Who caused the event (uid) — excluded from recipients upstream. */
  actorId?: string | null;
}

/**
 * Write one notification per recipient. Best-effort by design: a notification
 * must never break the event it describes, so write failures are logged, not
 * thrown — callers fire-and-forget this.
 */
export async function notifyUsers(recipients: string[], input: NotifyInput): Promise<number> {
  const ids = dedupeIds(recipients).filter((id) => id !== input.actorId);
  if (ids.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    try {
      const batch = adminDb().batch();
      const now = FieldValue.serverTimestamp();
      for (const userId of chunk) {
        const doc: WriteModel<NotificationDoc> = {
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          actorId: input.actorId ?? null,
          read: false,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        };
        batch.create(notificationsCol().doc(), doc as WriteModel<NotificationDoc>);
      }
      await batch.commit();
      written += chunk.length;
    } catch (err) {
      console.error("[notifications] batch write failed", err);
    }
  }
  return written;
}

export interface StudentStaffRecipients {
  /** School admins (or the creator, for standalone students). */
  adminIds: string[];
  /** Teachers assigned to the student's class. */
  teacherIds: string[];
  student: WithId<import("@/types/firestore").UserDoc>;
}

/**
 * Resolve the staff who should hear about a student's activity: the school's
 * admins plus the teachers assigned to the student's class (standalone
 * students route to their creator instead).
 */
export async function staffRecipientsForStudent(studentId: string): Promise<StudentStaffRecipients | null> {
  const studentSnap = await userDoc(studentId).get();
  if (!studentSnap.exists) return null;
  const student = { id: studentSnap.id, ...studentSnap.data()! } as WithId<import("@/types/firestore").UserDoc>;

  let adminIds: string[] = [];
  if (student.schoolId) {
    const adminsSnap = await usersCol()
      .where("role", "==", "admin")
      .where("schoolId", "==", student.schoolId)
      .select("role")
      .get();
    adminIds = adminsSnap.docs.map((d) => d.id);
  } else if (student.createdBy) {
    adminIds = [student.createdBy];
  }

  let teacherIds: string[] = [];
  if (student.classId) {
    const classSnap = await classDoc(student.classId).get().catch(() => null);
    if (classSnap?.exists) teacherIds = classSnap.data()!.teacherIds ?? [];
  }

  return { adminIds: dedupeIds(adminIds), teacherIds: dedupeIds(teacherIds), student };
}
