import { FieldValue } from "firebase-admin/firestore";

import { schoolsCol, usersCol, walletDoc } from "@/server/firebase/collections";
import { provisionUser } from "@/server/services/users";
import { writeAudit } from "@/server/services/audit";
import type { SessionUser } from "@/server/auth/session";
import type { WithId, SchoolDoc, UserDoc, WalletDoc } from "@/types/firestore";
import type {
  CreateSchoolInput,
  CreateStandaloneAdminInput,
} from "@/lib/schemas/users";

export class SchoolsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
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
    ownerUid: "pending",
    country: "UG",
    adminCount: 0,
    studentCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  const owner = await provisionUser(actor, {
    email: input.ownerEmail,
    password: input.ownerPassword,
    displayName: input.ownerName,
    role: "admin",
    schoolId: schoolRef.id,
  });

  await schoolRef.update({
    ownerUid: owner.id,
    adminCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // School wallet starts at zero tokens; super admin tops it up.
  await walletDoc(schoolRef.id).set({
    ownerId: schoolRef.id,
    ownerType: "school",
    balanceTokens: 0,
    totalTopupTokens: 0,
    totalConsumedTokens: 0,
    createdAt: now,
    updatedAt: now,
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "school.created",
    targetType: "school",
    targetId: schoolRef.id,
    meta: { name: input.schoolName, ownerUid: owner.id },
  });

  const schoolSnap = await schoolRef.get();
  return {
    school: { id: schoolRef.id, ...schoolSnap.data()! },
    owner,
  };
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
  });
  return admin;
}

export async function listSchools(): Promise<WithId<SchoolDoc>[]> {
  const snap = await schoolsCol().orderBy("createdAt", "desc").limit(500).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

export async function getSchoolWithUsers(
  schoolId: string,
): Promise<{ school: WithId<SchoolDoc>; admins: WithId<UserDoc>[]; students: WithId<UserDoc>[] }> {
  const snap = await schoolsCol().doc(schoolId).get();
  if (!snap.exists) throw new SchoolsServiceError("School not found.", 404);
  const school = { id: snap.id, ...snap.data()! } as WithId<SchoolDoc>;

  const [adminsSnap, studentsSnap] = await Promise.all([
    usersCol().where("schoolId", "==", schoolId).where("role", "==", "admin").get(),
    usersCol().where("schoolId", "==", schoolId).where("role", "==", "student").get(),
  ]);
  return {
    school,
    admins: adminsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    students: studentsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
  };
}

export async function getWallet(ownerId: string): Promise<WalletDoc | null> {
  const snap = await walletDoc(ownerId).get();
  return snap.exists ? snap.data()! : null;
}

export async function resolveActorWalletId(actor: SessionUser): Promise<string> {
  // School admins bill to the school wallet; standalone admins to their own.
  return actor.schoolId ?? actor.uid;
}
