import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminAuth } from "@/server/firebase/admin";
import {
  schoolsCol,
  userDoc,
  usersCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, UserDoc, WriteModel } from "@/types/firestore";
import type { Role } from "@/lib/constants";
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
  classLevel?: number | null;
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
  await adminAuth().setCustomUserClaims(created.uid, {
    role: input.role,
    schoolId: input.schoolId,
  });

  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<UserDoc> = {
    email: input.email,
    displayName: input.displayName,
    photoURL: null,
    role: input.role,
    schoolId: input.schoolId,
    status: "active",
    classLevel: input.classLevel ?? null,
    level: input.level ?? null,
    createdBy: actor.uid,
    banReason: null,
    suspendedUntil: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    lastLoginMeta: null,
  };
  await userDoc(created.uid).set(doc);
  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "user.created",
    targetType: "user",
    targetId: created.uid,
    meta: { role: input.role, schoolId: input.schoolId },
  });

  return {
    id: created.uid,
    ...(doc as UserDoc),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  } satisfies WithId<UserDoc>;
}

/** Admin creates a student under their school (or standalone household). */
export async function createStudent(
  actor: SessionUser,
  input: CreateStudentInput,
): Promise<WithId<UserDoc>> {
  if (actor.role !== "admin") {
    throw new UsersServiceError("Only admins can create students.", 403);
  }
  const schoolId = actor.schoolId ?? input.schoolId ?? null;
  const student = await provisionUser(actor, {
    ...input,
    role: "student",
    schoolId,
    level: input.level,
    classLevel: input.classLevel,
  });

  if (schoolId) {
    await schoolsCol().doc(schoolId).update({
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
}

/** Students visible to an admin: same school, or all students for super admin. */
export async function listStudents(actor: SessionUser): Promise<WithId<UserDoc>[]> {
  let query = usersCol().where("role", "==", "student");
  if (actor.role === "admin" && actor.schoolId) {
    query = query.where("schoolId", "==", actor.schoolId);
  } else if (actor.role === "admin") {
    // Standalone admin: students they created.
    query = query.where("createdBy", "==", actor.uid);
  }
  const snap = await query.orderBy("createdAt", "desc").limit(500).get();
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
  if (actor.role === "admin" && actor.schoolId && doc.schoolId !== actor.schoolId) {
    throw new UsersServiceError("This student belongs to another school.", 403);
  }
  return doc;
}
