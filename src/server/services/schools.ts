import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { adminAuth } from "@/server/firebase/admin";
import {
  classesBySchool,
  schoolDoc,
  schoolsCol,
  userDoc,
  usersCol,
  walletDoc,
} from "@/server/firebase/collections";
import { provisionUser } from "@/server/services/users";
import { createClassesForSchool } from "@/server/services/classes";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, SchoolDoc, UserDoc, WalletDoc, WriteModel } from "@/types/firestore";
import type {
  CreateSchoolInput,
  CreateStandaloneAdminInput,
} from "@/lib/schemas/users";
import type {
  CreateSelfSchoolInput,
  UpdateSchoolProfileInput,
} from "@/lib/schemas/school";
import { standardClassLevelsForLevel } from "@/lib/constants";

export class SchoolsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

function schoolWalletBase(): Omit<WriteModel<WalletDoc>, "createdAt" | "updatedAt"> {
  return {
    ownerId: "",
    ownerType: "school",
    balanceTokens: 0,
    totalTopupTokens: 0,
    totalConsumedTokens: 0,
  };
}

async function initializeSchoolWallet(schoolId: string, now: FieldValue) {
  await walletDoc(schoolId).set({
    ...schoolWalletBase(),
    ownerId: schoolId,
    createdAt: now,
    updatedAt: now,
  } as WriteModel<WalletDoc>);
}

/**
 * Super Admin creates a school together with its owner-admin account.
 * The school wallet (billing) is initialized at the same time.
 */
export async function createSchoolWithOwner(
  actor: SessionUser,
  input: CreateSchoolInput,
): Promise<{ school: WithId<SchoolDoc>; owner: WithId<UserDoc> }> {
  if (actor.role !== "super_admin") {
    throw new SchoolsServiceError("Only super admins can create schools.", 403);
  }

  const now = FieldValue.serverTimestamp();
  const schoolRef = await schoolsCol().add({
    name: input.schoolName,
    nameLower: input.schoolName.toLowerCase(),
    ownerUid: "pending",
    country: "UG",
    level: input.level,
    motto: null,
    address: null,
    phone: null,
    email: null,
    registrationNumber: null,
    logoUrl: null,
    description: null,
    verification: "unverified",
    verifiedAt: null,
    verifiedBy: null,
    adminCount: 0,
    teacherCount: 0,
    studentCount: 0,
    createdAt: now,
    updatedAt: now,
  } as WriteModel<SchoolDoc>);

  let owner;
  try {
    owner = await provisionUser(actor, {
      email: input.ownerEmail,
      password: input.ownerPassword,
      displayName: input.ownerName,
      role: "admin",
      schoolId: schoolRef.id,
    });
  } catch (err) {
    // Don't leave an orphaned, ownerless school behind when provisioning
    // fails (e.g. duplicate email → 409).
    await schoolRef.delete().catch(() => undefined);
    throw err;
  }

  await schoolRef.update({
    ownerUid: owner.id,
    adminCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // School wallet starts at zero tokens; the admin tops it up (pay-as-you-go).
  await initializeSchoolWallet(schoolRef.id, now);

  // Give new schools their full standard class set for the chosen level.
  await createClassesForSchool({
    schoolId: schoolRef.id,
    schoolLevel: input.level,
    createdBy: owner.id,
    classLevels: [...standardClassLevelsForLevel(input.level)],
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "school.created",
    targetType: "school",
    targetId: schoolRef.id,
    meta: { name: input.schoolName, level: input.level, ownerUid: owner.id },
  });

  const schoolSnap = await schoolRef.get();
  return {
    school: { id: schoolRef.id, ...schoolSnap.data()! },
    owner,
  };
}

/**
 * A member (signed-up user) creates their own school and becomes its admin.
 * This is the self-serve "join → create school" path from onboarding; the
 * acting user is promoted from role "member" to "admin" in the same flow.
 */
export async function createSchoolForSelf(
  actor: SessionUser,
  input: CreateSelfSchoolInput,
): Promise<WithId<SchoolDoc>> {
  if (actor.role !== "member") {
    throw new SchoolsServiceError("Only new members can create a school here.", 403);
  }
  if (actor.schoolId) {
    throw new SchoolsServiceError("You already belong to a school.", 409);
  }

  const level = input.level;
  const requestedLevels = input.classLevels?.length
    ? input.classLevels
    : [...standardClassLevelsForLevel(level)];
  const validLevels = standardClassLevelsForLevel(level);
  const classLevels = requestedLevels.filter((n) => (validLevels as readonly number[]).includes(n));
  if (classLevels.length === 0) {
    throw new SchoolsServiceError("Select at least one valid class for this school level.");
  }

  const now = FieldValue.serverTimestamp();
  const schoolRef = await schoolsCol().add({
    name: input.name,
    nameLower: input.name.toLowerCase(),
    ownerUid: actor.uid,
    country: "UG",
    level,
    motto: input.motto ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    registrationNumber: input.registrationNumber ?? null,
    logoUrl: null,
    description: input.description ?? null,
    verification: "unverified",
    verifiedAt: null,
    verifiedBy: null,
    adminCount: 1,
    teacherCount: 0,
    studentCount: 0,
    createdAt: now,
    updatedAt: now,
  } as WriteModel<SchoolDoc>);

  try {
    await initializeSchoolWallet(schoolRef.id, now);

    await createClassesForSchool({
      schoolId: schoolRef.id,
      schoolLevel: level,
      createdBy: actor.uid,
      classLevels,
    });

    // Promote the member to the school's admin — the Firestore doc AND the
    // custom claims together. `getCurrentUser` reads schoolId from the doc and
    // role from the (fresh) claims, so both must move in the same step or the
    // next request half-exists: admin by claims, school-less by doc.
    await userDoc(actor.uid).update({
      role: "admin",
      schoolId: schoolRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminAuth().setCustomUserClaims(actor.uid, {
      role: "admin",
      schoolId: schoolRef.id,
    });
    await schoolDoc(schoolRef.id).update({ updatedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    // Roll back the school artifacts and any half-applied promotion so the
    // member can retry cleanly — stale claims pointing at a deleted school
    // would poison every guard on the next request.
    await adminAuth()
      .setCustomUserClaims(actor.uid, { role: "member", schoolId: null })
      .catch(() => undefined);
    await userDoc(actor.uid)
      .update({ role: "member", schoolId: null, updatedAt: FieldValue.serverTimestamp() })
      .catch(() => undefined);
    const classSnap = await classesBySchool(schoolRef.id).get().catch(() => null);
    if (classSnap) {
      await Promise.all(classSnap.docs.map((d) => d.ref.delete().catch(() => undefined)));
    }
    await walletDoc(schoolRef.id).delete().catch(() => undefined);
    await schoolRef.delete().catch(() => undefined);
    throw err;
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "school.created_self",
    targetType: "school",
    targetId: schoolRef.id,
    meta: { name: input.name, level, classes: classLevels.length },
  });

  const snap = await schoolRef.get();
  return { id: schoolRef.id, ...snap.data()! };
}

/** School admin updates their school's public profile. */
export async function updateSchoolProfile(
  actor: SessionUser,
  input: UpdateSchoolProfileInput,
): Promise<void> {
  if (actor.role !== "admin" || !actor.schoolId) {
    throw new SchoolsServiceError("Only school admins can edit the school profile.", 403);
  }
  const ref = schoolDoc(actor.schoolId);
  const snap = await ref.get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);

  await ref.update({
    name: input.name,
    nameLower: input.name.toLowerCase(),
    motto: input.motto,
    address: input.address,
    phone: input.phone,
    email: input.email,
    registrationNumber: input.registrationNumber,
    description: input.description,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "school.profile_updated",
    targetType: "school",
    targetId: actor.schoolId,
  });
}

/**
 * Admin submits the school for blue-tick verification. Requires the details
 * that let the super admin distinguish the school: official name, registration
 * number and an address.
 */
export async function requestSchoolVerification(actor: SessionUser): Promise<void> {
  if (actor.role !== "admin" || !actor.schoolId) {
    throw new SchoolsServiceError("Only school admins can request verification.", 403);
  }
  const ref = schoolDoc(actor.schoolId);
  const snap = await ref.get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);
  const school = snap.data()!;
  if (school.verification === "verified") {
    throw new SchoolsServiceError("This school is already verified.", 409);
  }
  if (!school.registrationNumber?.trim() || !school.address?.trim()) {
    throw new SchoolsServiceError(
      "Add your official registration number and address before requesting verification.",
      400,
    );
  }

  await ref.update({
    verification: "pending",
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "school.verification_requested",
    targetType: "school",
    targetId: actor.schoolId,
  });
}

/** Super Admin grants or revokes the blue tick. */
export async function setSchoolVerification(
  actor: SessionUser,
  schoolId: string,
  verified: boolean,
): Promise<void> {
  if (actor.role !== "super_admin") {
    throw new SchoolsServiceError("Only super admins can verify schools.", 403);
  }
  const ref = schoolDoc(schoolId);
  const snap = await ref.get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);

  await ref.update({
    verification: verified ? "verified" : "unverified",
    verifiedAt: verified ? Timestamp.now() : null,
    verifiedBy: verified ? actor.uid : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: verified ? "school.verified" : "school.unverified",
    targetType: "school",
    targetId: schoolId,
  });
}

/** Standalone admins (parents/tutors) — no school org, wallet on their uid. */
export async function createStandaloneAdmin(
  actor: SessionUser,
  input: CreateStandaloneAdminInput,
): Promise<WithId<UserDoc>> {
  if (actor.role !== "super_admin") {
    throw new SchoolsServiceError("Only super admins can create admins.", 403);
  }
  const admin = await provisionUser(actor, {
    ...input,
    role: "admin",
    schoolId: null,
  });
  const now = FieldValue.serverTimestamp();
  await walletDoc(admin.id).set({
    ownerId: admin.id,
    ownerType: "admin",
    balanceTokens: 0,
    totalTopupTokens: 0,
    totalConsumedTokens: 0,
    createdAt: now,
    updatedAt: now,
  } as WriteModel<WalletDoc>);
  return admin;
}

/** Total number of schools (cheap aggregate for truncation indicators). */
export async function countSchools(): Promise<number> {
  const snap = await schoolsCol().count().get();
  return snap.data().count;
}

export async function listSchools(limit = 500): Promise<WithId<SchoolDoc>[]> {
  const snap = await schoolsCol().orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

export async function getSchoolById(schoolId: string): Promise<WithId<SchoolDoc>> {
  const snap = await schoolDoc(schoolId).get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);
  return { id: snap.id, ...snap.data()! };
}

export async function getSchoolWithUsers(
  schoolId: string,
): Promise<{
  school: WithId<SchoolDoc>;
  admins: WithId<UserDoc>[];
  teachers: WithId<UserDoc>[];
  students: WithId<UserDoc>[];
}> {
  const snap = await schoolDoc(schoolId).get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);
  const school = { id: snap.id, ...snap.data()! } as WithId<SchoolDoc>;

  const [adminsSnap, teachersSnap, studentsSnap] = await Promise.all([
    usersCol().where("schoolId", "==", schoolId).where("role", "==", "admin").get(),
    usersCol().where("schoolId", "==", schoolId).where("role", "==", "teacher").get(),
    usersCol().where("schoolId", "==", schoolId).where("role", "==", "student").get(),
  ]);
  return {
    school,
    admins: adminsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    teachers: teachersSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    students: studentsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
  };
}

export async function getWallet(ownerId: string): Promise<WalletDoc | null> {
  const snap = await walletDoc(ownerId).get();
  return snap.exists ? snap.data()! : null;
}

export async function resolveActorWalletId(actor: SessionUser): Promise<string> {
  // School staff bill to the school wallet; standalone admins to their own.
  return actor.schoolId ?? actor.uid;
}
