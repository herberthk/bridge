import { FieldValue, Timestamp } from "firebase-admin/firestore";
import React from "react";

import { adminAuth } from "@/server/firebase/admin";
import {
  classDoc,
  schoolsCol,
  userDoc,
  usersCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { appUrl, sendTemplateEmail } from "@/server/services/email";
import { StudentInviteEmail, BanNoticeEmail } from "@/emails/templates";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, UserDoc, WriteModel } from "@/types/firestore";
import { isStaffRole, type Role } from "@/lib/constants";
import type {
  CreateStudentInput,
  SetUserStatusInput,
} from "@/lib/schemas/users";

export class UsersServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

interface ProvisionInput {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  schoolId: string | null;
  level?: "primary" | "secondary" | null;
  secondarySubLevel?: "o_level" | "a_level" | null;
  classLevel?: number | null;
  /** Students only: class membership (classes collection). */
  classId?: string | null;
  /** Teachers only: classes assigned to manage. */
  assignedClassIds?: string[] | null;
  /** Skip the invite email (e.g. the temp password was shown in-UI only). */
  suppressInviteEmail?: boolean;
}

/** Create the Auth user + profile doc + custom claims in one step. */
export async function provisionUser(
  actor: SessionUser,
  input: ProvisionInput,
): Promise<WithId<UserDoc>> {
  const existing = await adminAuth()
    .getUserByEmail(input.email)
    .catch(() => null);
  if (existing) {
    throw new UsersServiceError("An account with this email already exists.", 409);
  }

  const created = await adminAuth().createUser({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
  });

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<UserDoc> = {
    email: input.email,
    displayName: input.displayName,
    displayNameLower: input.displayName.toLowerCase(),
    photoURL: null,
    role: input.role,
    schoolId: input.schoolId,
    status: "active",
    classLevel: input.classLevel ?? null,
    level: input.level ?? null,
    secondarySubLevel: input.secondarySubLevel ?? null,
    classId: input.classId ?? null,
    assignedClassIds: input.assignedClassIds ?? null,
    createdBy: actor.uid,
    banReason: null,
    suspendedUntil: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginMeta: null,
  };

  try {
    await adminAuth().setCustomUserClaims(created.uid, {
      role: input.role,
      schoolId: input.schoolId,
    });

    await userDoc(created.uid).set(doc);
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "user.created",
      targetType: "user",
      targetId: created.uid,
      meta: { role: input.role, schoolId: input.schoolId },
    });
  } catch (err) {
    // Roll back: delete the Auth user and any created Firestore doc.
    await adminAuth().deleteUser(created.uid).catch(() => undefined);
    await userDoc(created.uid).delete().catch(() => undefined);
    throw err;
  }

  if (input.role === "student" && !input.suppressInviteEmail) {
    void sendTemplateEmail({
      to: input.email,
      subject: "Your Bridge student account is ready",
      template: React.createElement(StudentInviteEmail, {
        displayName: input.displayName,
        email: input.email,
        temporaryPassword: input.password,
        loginUrl: appUrl("/login"),
      }),
    });
  }

  return {
    id: created.uid,
    ...(doc as UserDoc),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } satisfies WithId<UserDoc>;
}

/**
 * Staff (admin or teacher) create a student under their school — optionally
 * directly into a class, which then determines the student's level/class year.
 */
export async function createStudent(
  actor: SessionUser,
  input: CreateStudentInput,
): Promise<WithId<UserDoc>> {
  if (!isStaffRole(actor.role) && actor.role !== "super_admin") {
    throw new UsersServiceError("Only school staff can create students.", 403);
  }
  const schoolId = actor.schoolId ?? input.schoolId ?? null;

  // Membership of a class fully determines level + class year.
  let classId: string | null = null;
  let level = input.level ?? null;
  let classLevel = input.classLevel ?? null;
  let secondarySubLevel = input.secondarySubLevel ?? null;
  if (input.classId) {
    const classSnap = await classDoc(input.classId).get();
    if (!classSnap.exists) {
      throw new UsersServiceError("Class not found.", 404);
    }
    const cls = classSnap.data()!;
    if (!schoolId || cls.schoolId !== schoolId) {
      throw new UsersServiceError("This class belongs to another school.", 403);
    }
    if (
      actor.role === "teacher" &&
      !(cls.teacherIds ?? []).includes(actor.uid)
    ) {
      throw new UsersServiceError("You are not assigned to this class.", 403);
    }
    classId = input.classId;
    level = cls.level;
    classLevel = cls.classLevel;
    secondarySubLevel = cls.secondarySubLevel;
  }

  const student = await provisionUser(actor, {
    ...input,
    role: "student",
    schoolId,
    level,
    secondarySubLevel,
    classLevel,
    classId,
  });

  if (schoolId) {
    await schoolsCol().doc(schoolId).update({
      studentCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (classId) {
    await classDoc(classId).update({
      studentCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return student;
}

/** Ban / suspend / reactivate a student. Suspensions can have an end date. */
export async function setUserStatus(
  actor: SessionUser,
  input: SetUserStatusInput,
): Promise<void> {
  const snap = await userDoc(input.userId).get();
  if (!snap.exists) throw new UsersServiceError("User not found.", 404);
  const target = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;

  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new UsersServiceError("Not allowed.", 403);
  }
  if (actor.role === "admin" && target.role !== "student") {
    throw new UsersServiceError("Admins can only manage students.", 403);
  }
  if (actor.role === "admin" && actor.schoolId && target.schoolId !== actor.schoolId) {
    throw new UsersServiceError("This student belongs to another school.", 403);
  }
  if (target.role === "super_admin") {
    throw new UsersServiceError("Super admins cannot be modified here.", 403);
  }

  await userDoc(target.id).update({
    status: input.status,
    banReason:
      input.status === "banned"
        ? (input.reason ?? "Exam integrity violation")
        : null,
    suspendedUntil:
      input.status === "suspended" && input.suspendedUntil
        ? Timestamp.fromMillis(Date.parse(input.suspendedUntil))
        : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Force re-login so status takes effect immediately.
  await adminAuth().revokeRefreshTokens(target.id).catch(() => undefined);

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: `user.status.${input.status}`,
    targetType: "user",
    targetId: target.id,
    meta: { reason: input.reason ?? null },
  });

  if (input.status === "banned") {
    void sendTemplateEmail({
      to: target.email,
      subject: "Your Bridge account has been banned",
      template: React.createElement(BanNoticeEmail, {
        displayName: target.displayName,
        reason: input.reason ?? "Exam integrity violation",
        adminContact: actor.email ?? "your administrator",
      }),
    });
  }
}

/** Total students visible to staff — cheap count aggregate. */
export async function countStudents(actor: SessionUser): Promise<number> {
  let query = usersCol().where("role", "==", "student");
  if (actor.schoolId && isStaffRole(actor.role)) {
    query = query.where("schoolId", "==", actor.schoolId);
  } else if (isStaffRole(actor.role)) {
    // Standalone admin: students they created.
    query = query.where("createdBy", "==", actor.uid);
  }
  const snap = await query.count().get();
  return snap.data().count;
}

/** Students visible to staff: same school, or all students for super admin. */
export async function listStudents(actor: SessionUser): Promise<WithId<UserDoc>[]> {
  let query = usersCol().where("role", "==", "student");
  if (actor.schoolId && isStaffRole(actor.role)) {
    query = query.where("schoolId", "==", actor.schoolId);
  } else if (isStaffRole(actor.role)) {
    // Standalone admin: students they created.
    query = query.where("createdBy", "==", actor.uid);
  }
  const snap = await query.orderBy("createdAt", "desc").limit(500).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** All teachers + admins of the acting staff member's school. */
export async function listSchoolStaff(
  actor: SessionUser,
): Promise<{ admins: WithId<UserDoc>[]; teachers: WithId<UserDoc>[] }> {
  if (!actor.schoolId) return { admins: [], teachers: [] };
  const [adminsSnap, teachersSnap] = await Promise.all([
    usersCol().where("role", "==", "admin").where("schoolId", "==", actor.schoolId).get(),
    usersCol().where("role", "==", "teacher").where("schoolId", "==", actor.schoolId).get(),
  ]);
  return {
    admins: adminsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    teachers: teachersSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
  };
}

/** All teachers of a school (admin view; callable for any school by super admin). */
export async function listTeachers(schoolId: string): Promise<WithId<UserDoc>[]> {
  const snap = await usersCol()
    .where("role", "==", "teacher")
    .where("schoolId", "==", schoolId)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

export async function getStudent(
  actor: SessionUser,
  studentId: string,
): Promise<WithId<UserDoc>> {
  const snap = await userDoc(studentId).get();
  if (!snap.exists) throw new UsersServiceError("Student not found.", 404);
  const doc = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;
  if (doc.role !== "student") throw new UsersServiceError("Not a student.", 400);
  if (isStaffRole(actor.role) && actor.schoolId && doc.schoolId !== actor.schoolId) {
    throw new UsersServiceError("This student belongs to another school.", 403);
  }
  return doc;
}
