import { createHash, randomBytes } from "node:crypto";
import React from "react";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminAuth } from "@/server/firebase/admin";
import {
  classDoc,
  classesBySchool,
  invitesCol,
  schoolDoc,
  userDoc,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { appUrl, sendTemplateEmail } from "@/server/services/email";
import { TeacherInviteEmail, InviteRevokedEmail } from "@/emails/templates";
import type { SessionUser } from "@/server/auth/session";
import type { ClassDoc, InviteDoc, UserDoc, WithId, WriteModel } from "@/types/firestore";
import { INVITE_TTL_DAYS } from "@/lib/constants";
import type { CreateTeacherInviteInput } from "@/lib/schemas/school";

export class InvitesServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/* ── Pure token helpers (unit-tested) ───────────────────────────────── */

export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isInviteExpired(
  invite: { expiresAt: { toMillis?: () => number } | null | undefined },
  nowMs = Date.now(),
): boolean {
  const ms = invite.expiresAt?.toMillis?.();
  return typeof ms === "number" ? ms <= nowMs : true;
}

/* ── Invitations ────────────────────────────────────────────────────── */

/** Admin creates + emails a teacher invite; returns the raw link for sharing. */
export async function createTeacherInvite(
  actor: SessionUser,
  input: CreateTeacherInviteInput,
): Promise<{ invite: WithId<InviteDoc>; inviteUrl: string }> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new InvitesServiceError("Only admins can invite teachers.", 403);
  }
  if (!actor.schoolId) {
    throw new InvitesServiceError("You are not part of a school.", 403);
  }
  const email = input.email.toLowerCase();

  const schoolSnap = await schoolDoc(actor.schoolId).get();
  if (!schoolSnap.exists) throw new InvitesServiceError("School not found.", 404);
  const school = schoolSnap.data()!;

  const existingAuth = await adminAuth()
    .getUserByEmail(email)
    .catch(() => null);
  if (existingAuth) {
    throw new InvitesServiceError("An account with this email already exists.", 409);
  }

  // Validate pre-assigned classes belong to this school.
  if (input.classIds.length > 0) {
    const classSnaps = await Promise.all(input.classIds.map((id) => classDoc(id).get()));
    classSnaps.forEach((snap, i) => {
      if (!snap.exists) {
        throw new InvitesServiceError(`Class not found: ${input.classIds[i]}.`, 404);
      }
      if (snap.data()!.schoolId !== actor.schoolId) {
        throw new InvitesServiceError("A selected class belongs to another school.", 403);
      }
    });
  }

  // Block duplicate *pending* invites for the same school + email.
  const pending = await invitesCol()
    .where("schoolId", "==", actor.schoolId)
    .where("email", "==", email)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (!pending.empty) {
    throw new InvitesServiceError("An invite for this email is already pending.", 409);
  }

  const token = generateInviteToken();
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = FieldValue.serverTimestamp();
  const doc: WriteModel<InviteDoc> = {
    schoolId: actor.schoolId,
    schoolName: school.name,
    email,
    role: "teacher",
    classIds: input.classIds,
    status: "pending",
    tokenHash: hashInviteToken(token),
    invitedBy: actor.uid,
    invitedByName: actor.displayName,
    expiresAt,
    acceptedAt: null,
    acceptedBy: null,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await invitesCol().add(doc as WriteModel<InviteDoc>);

  const inviteUrl = appUrl(`/invite/${token}`);
  void sendTemplateEmail({
    to: email,
    subject: `You're invited to teach at ${school.name} on Bridge`,
    template: React.createElement(TeacherInviteEmail, {
      displayName: "",
      schoolName: school.name,
      invitedByName: actor.displayName,
      inviteUrl,
      expiresAt: expiresAt.toDate(),
    }),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "invite.created",
    targetType: "invite",
    targetId: ref.id,
    meta: { email, schoolId: actor.schoolId, classes: input.classIds.length },
  });

  const saved = await ref.get();
  return { invite: { id: ref.id, ...saved.data()! }, inviteUrl };
}

export async function listInvites(actor: SessionUser): Promise<WithId<InviteDoc>[]> {
  if (!actor.schoolId) return [];
  const snap = await invitesCol()
    .where("schoolId", "==", actor.schoolId)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/** Admin revokes a pending invite — the link stops working immediately. */
export async function revokeInvite(actor: SessionUser, inviteId: string): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new InvitesServiceError("Not allowed.", 403);
  }
  const ref = invitesCol().doc(inviteId);
  const snap = await ref.get();
  if (!snap.exists) throw new InvitesServiceError("Invite not found.", 404);
  const invite = snap.data()!;
  if (actor.role === "admin" && invite.schoolId !== actor.schoolId) {
    throw new InvitesServiceError("This invite belongs to another school.", 403);
  }
  if (invite.status !== "pending") {
    throw new InvitesServiceError("Only pending invites can be revoked.", 409);
  }

  await ref.update({
    status: "revoked",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "invite.revoked",
    targetType: "invite",
    targetId: inviteId,
  });

  void sendTemplateEmail({
    to: invite.email,
    subject: `Your Bridge invite to ${invite.schoolName} was revoked`,
    template: React.createElement(InviteRevokedEmail, {
      schoolName: invite.schoolName,
    }),
  });
}

/** Public data for the accept screen, keyed by the raw token. */
export async function getInviteForToken(
  token: string,
): Promise<{ invite: WithId<InviteDoc> } | { error: string; status: number }> {
  const tokenHash = hashInviteToken(token);
  const snap = await invitesCol().where("tokenHash", "==", tokenHash).limit(1).get();
  if (snap.empty) {
    return { error: "This invite link is invalid.", status: 404 };
  }
  const invite = { id: snap.docs[0]!.id, ...snap.docs[0]!.data()! } as WithId<InviteDoc>;
  if (invite.status !== "pending") {
    return { error: "This invite is no longer active.", status: 409 };
  }
  if (isInviteExpired(invite)) {
    return { error: "This invite has expired — ask your admin for a new one.", status: 410 };
  }
  return { invite };
}

/**
 * Accept a teacher invite: create the Auth account + profile + claims, add
 * the teacher to their pre-assigned classes and mark the invite accepted.
 * Runs without a session — the single-use token is the authority.
 */
export async function acceptTeacherInvite(input: {
  token: string;
  displayName: string;
  password: string;
}): Promise<{ email: string; schoolId: string }> {
  const lookup = await getInviteForToken(input.token);
  if ("error" in lookup) {
    throw new InvitesServiceError(lookup.error, lookup.status);
  }
  const invite = lookup.invite;

  const existingAuth = await adminAuth()
    .getUserByEmail(invite.email)
    .catch(() => null);
  if (existingAuth) {
    throw new InvitesServiceError("An account with this email already exists.", 409);
  }

  const created = await adminAuth().createUser({
    email: invite.email,
    password: input.password,
    displayName: input.displayName,
    emailVerified: false,
  });

  const now = FieldValue.serverTimestamp();
  try {
    await adminAuth().setCustomUserClaims(created.uid, {
      role: "teacher",
      schoolId: invite.schoolId,
    });
    await userDoc(created.uid).set({
      email: invite.email,
      displayName: input.displayName,
      displayNameLower: input.displayName.toLowerCase(),
      photoURL: null,
      role: "teacher",
      schoolId: invite.schoolId,
      status: "active",
      classLevel: null,
      level: null,
      secondarySubLevel: null,
      classId: null,
      assignedClassIds: invite.classIds,
      createdBy: invite.invitedBy,
      banReason: null,
      suspendedUntil: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      lastLoginMeta: null,
    } as WriteModel<UserDoc>);

    // Add the teacher to each pre-assigned class + count them on the school.
    for (const classId of invite.classIds) {
      const classRef = classDoc(classId);
      const classSnap = await classRef.get().catch(() => null);
      if (classSnap?.exists && classSnap.data()!.schoolId === invite.schoolId) {
        await classRef.update({
          teacherIds: FieldValue.arrayUnion(created.uid),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await schoolDoc(invite.schoolId).update({
      teacherCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await invitesCol().doc(invite.id).update({
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedBy: created.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    await adminAuth().deleteUser(created.uid).catch(() => undefined);
    await userDoc(created.uid).delete().catch(() => undefined);
    throw err;
  }

  await writeAudit({
    actorId: created.uid,
    actorRole: "teacher",
    action: "invite.accepted",
    targetType: "invite",
    targetId: invite.id,
    meta: { schoolId: invite.schoolId },
  });

  return { email: invite.email, schoolId: invite.schoolId };
}

/** Pending invites for a school keyed by email — used to dedupe invites. */
export async function hasPendingInvite(schoolId: string, email: string): Promise<boolean> {
  const snap = await invitesCol()
    .where("schoolId", "==", schoolId)
    .where("email", "==", email.toLowerCase())
    .where("status", "==", "pending")
    .limit(1)
    .get();
  return !snap.empty;
}

/** Classes a teacher manages (assigned to them, ordered by class year). */
export async function listClassesForTeacher(
  schoolId: string,
  teacher: WithId<UserDoc>,
): Promise<WithId<ClassDoc>[]> {
  const snap = await classesBySchool(schoolId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data()! }))
    .filter((c) => (teacher.assignedClassIds ?? []).includes(c.id))
    .sort((a, b) => a.classLevel - b.classLevel);
}

/** Ensure a user id refers to a teacher of the given school (invite dialogs). */
export async function assertSchoolTeacher(
  schoolId: string,
  userId: string,
): Promise<WithId<UserDoc>> {
  const snap = await userDoc(userId).get();
  if (!snap.exists) throw new InvitesServiceError("Teacher not found.", 404);
  const user = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;
  if (user.role !== "teacher" || user.schoolId !== schoolId) {
    throw new InvitesServiceError("That user is not a teacher of this school.", 400);
  }
  return user;
}

/** Cheap count for dashboard badges. */
export async function countPendingInvites(schoolId: string): Promise<number> {
  const snap = await invitesCol()
    .where("schoolId", "==", schoolId)
    .where("status", "==", "pending")
    .count()
    .get();
  return snap.data().count;
}
