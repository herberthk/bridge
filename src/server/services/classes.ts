import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/server/firebase/admin";
import {
  classDoc,
  classesBySchool,
  classesCol,
  countQuery,
  schoolDoc,
  userDoc,
  usersCol,
} from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import { canTeacherCreateClasses } from "@/server/services/users";
import type { SessionUser } from "@/server/auth/session";
import type {
  ClassDoc,
  UserDoc,
  WithId,
  WriteModel,
} from "@/types/firestore";
import {
  classLabel,
  standardClassLevelsForLevel,
  subLevelForClass,
  type SchoolLevel,
} from "@/lib/constants";
import type {
  CreateClassesInput,
  AssignTeacherClassesInput,
  SetTeacherCanCreateClassesInput,
} from "@/lib/schemas/school";

export class ClassesServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

interface CreateClassesResult {
  created: WithId<ClassDoc>[];
  membershipReconciled: boolean;
}

async function createClassesAtomic(input: {
  schoolId: string;
  schoolLevel: SchoolLevel;
  createdBy: string;
  classLevels: number[];
  assignTeacherId?: string;
}): Promise<CreateClassesResult> {
  const classLevels = [...new Set(input.classLevels)];
  const newRefs = new Map(classLevels.map((level) => [level, classesCol().doc()]));

  return adminDb().runTransaction(async (tx) => {
    const existing = await tx.get(classesBySchool(input.schoolId));
    const teacherSnap = input.assignTeacherId
      ? await tx.get(userDoc(input.assignTeacherId))
      : null;
    if (teacherSnap && !teacherSnap.exists) {
      throw new ClassesServiceError("Teacher not found.", 404);
    }

    const existingByLevel = new Map(existing.docs.map((d) => [d.data().classLevel, d]));
    const now = FieldValue.serverTimestamp();
    const created: WithId<ClassDoc>[] = [];
    const managedIds: string[] = [];
    let membershipReconciled = false;

    for (const classLevel of classLevels) {
      const current = existingByLevel.get(classLevel);
      if (current) {
        if (
          input.assignTeacherId &&
          (current.data().teacherIds ?? []).length > 0
        ) {
          throw new ClassesServiceError(
            `${current.data().name} is already assigned to a teacher.`,
            409,
          );
        }
        managedIds.push(current.id);
        if (input.assignTeacherId) {
          tx.update(current.ref, {
            teacherIds: FieldValue.arrayUnion(input.assignTeacherId),
            updatedAt: now,
          });
          membershipReconciled = true;
        }
        continue;
      }

      const ref = newRefs.get(classLevel)!;
      const doc: WriteModel<ClassDoc> = {
        schoolId: input.schoolId,
        level: input.schoolLevel,
        classLevel,
        secondarySubLevel:
          input.schoolLevel === "secondary" ? subLevelForClass(classLevel) : null,
        name: classLabel(input.schoolLevel, classLevel),
        teacherIds: input.assignTeacherId ? [input.assignTeacherId] : [],
        studentCount: 0,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      tx.create(ref, doc);
      managedIds.push(ref.id);
      created.push({ id: ref.id, ...(doc as ClassDoc) });
    }

    if (teacherSnap && input.assignTeacherId) {
      const previous = teacherSnap.data()!.assignedClassIds ?? [];
      const assignedClassIds = [...new Set([...previous, ...managedIds])];
      if (assignedClassIds.length !== previous.length) membershipReconciled = true;
      tx.update(teacherSnap.ref, {
        assignedClassIds,
        updatedAt: now,
      });
    }

    return { created, membershipReconciled };
  });
}

/** Internal: create classes without actor checks (used at school creation). */
export async function createClassesForSchool(input: {
  schoolId: string;
  schoolLevel: SchoolLevel;
  createdBy: string;
  classLevels: number[];
}): Promise<WithId<ClassDoc>[]> {
  return (await createClassesAtomic(input)).created;
}

/**
 * Staff create missing classes for their school. Admins always may; teachers
 * need the admin-granted `canCreateClasses` privilege — the same endpoint
 * also handles claiming unassigned classes, so the gate covers both.
 */
export async function createClasses(
  actor: SessionUser,
  input: CreateClassesInput,
): Promise<WithId<ClassDoc>[]> {
  if (actor.role !== "admin" && actor.role !== "teacher") {
    throw new ClassesServiceError("Only school staff can create classes.", 403);
  }
  if (!actor.schoolId) {
    throw new ClassesServiceError("You are not part of a school.", 403);
  }
  if (actor.role === "teacher" && !(await canTeacherCreateClasses(actor.uid))) {
    throw new ClassesServiceError(
      "Only your school admin can create or claim classes — ask them to grant you access.",
      403,
    );
  }
  const schoolSnap = await schoolDoc(actor.schoolId).get();
  if (!schoolSnap.exists) throw new ClassesServiceError("School not found.", 404);
  const school = schoolSnap.data()!;

  const valid = standardClassLevelsForLevel(school.level);
  const invalid = input.classLevels.filter(
    (n) => !(valid as readonly number[]).includes(n),
  );
  if (invalid.length > 0) {
    throw new ClassesServiceError(
      `Invalid class year(s) for a ${school.level} school: ${invalid.join(", ")}.`,
      400,
    );
  }

  const { created, membershipReconciled } = await createClassesAtomic({
    schoolId: actor.schoolId,
    schoolLevel: school.level,
    createdBy: actor.uid,
    classLevels: input.classLevels,
    assignTeacherId: actor.role === "teacher" ? actor.uid : undefined,
  });
  if (created.length === 0 && !membershipReconciled) {
    throw new ClassesServiceError("Those classes already exist.", 409);
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "class.created",
    targetType: "school",
    targetId: actor.schoolId,
    meta: { classes: created.map((c) => c.name), membershipReconciled },
  });
  return created;
}

/** Classes visible to the actor, ordered by class year.
 * Admins see every class of their school; teachers see only classes assigned
 * to them (mirrors `getClassForActor`, so listed cards never 404 on open). */
export async function listClasses(actor: SessionUser): Promise<WithId<ClassDoc>[]> {
  if (!actor.schoolId) return [];
  const snap = await classesBySchool(actor.schoolId).get();
  const all = snap.docs
    .map((d) => ({ id: d.id, ...d.data()! }))
    .sort((a, b) => a.classLevel - b.classLevel);
  if (actor.role === "teacher") {
    return all.filter((c) => (c.teacherIds ?? []).includes(actor.uid));
  }
  return all;
}

/** School-wide class levels that already have an owner and cannot be claimed. */
export async function listAssignedClassLevels(actor: SessionUser): Promise<number[]> {
  if (actor.role !== "admin" && actor.role !== "teacher") {
    throw new ClassesServiceError("Only school staff can list class assignments.", 403);
  }
  if (!actor.schoolId) return [];
  const snap = await classesBySchool(actor.schoolId).get();
  return snap.docs
    .filter((d) => (d.data().teacherIds ?? []).length > 0)
    .map((d) => d.data().classLevel);
}

/**
 * Load a class for staff management. Teachers may only manage classes that
 * are assigned to them; admins manage every class of their school.
 */
export async function getClassForActor(
  actor: SessionUser,
  classId: string,
): Promise<WithId<ClassDoc>> {
  if (actor.role !== "admin" && actor.role !== "teacher" && actor.role !== "super_admin") {
    throw new ClassesServiceError("Not allowed.", 403);
  }
  const snap = await classDoc(classId).get();
  if (!snap.exists) throw new ClassesServiceError("Class not found.", 404);
  const cls = { id: snap.id, ...snap.data()! } as WithId<ClassDoc>;
  if (actor.role === "super_admin") return cls;
  if (!actor.schoolId || cls.schoolId !== actor.schoolId) {
    throw new ClassesServiceError("This class belongs to another school.", 403);
  }
  if (actor.role === "teacher" && !(cls.teacherIds ?? []).includes(actor.uid)) {
    throw new ClassesServiceError("You are not assigned to this class.", 403);
  }
  return cls;
}

/**
 * Roster list cap — the tab shows the newest slice and relies on
 * `countClassStudents` for the exact total. Leaderboard rates are computed
 * over the listed slice, so in oversized classes they are approximate while
 * headcounts stay exact.
 */
export const CLASS_ROSTER_LIMIT = 500;

/**
 * Raw class roster read (no auth check) — shared by the management view and
 * the dashboard bundle so one request issues one roster query instead of
 * three. Newest first, capped at {@link CLASS_ROSTER_LIMIT}.
 */
export async function fetchClassStudents(classId: string): Promise<WithId<UserDoc>[]> {
  const snap = await usersCol()
    .where("role", "==", "student")
    .where("classId", "==", classId)
    .orderBy("createdAt", "desc")
    .limit(CLASS_ROSTER_LIMIT)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
}

/**
 * Exact class headcount via count aggregation — no doc reads, no cap. Used
 * wherever the capped list length would lie (hero total, drift check, stats).
 */
export async function countClassStudents(classId: string): Promise<number> {
  return countQuery(
    usersCol().where("role", "==", "student").where("classId", "==", classId),
  );
}

/** Students belonging to a class (management view). */
export async function listStudentsInClass(
  actor: SessionUser,
  classId: string,
): Promise<WithId<UserDoc>[]> {
  await getClassForActor(actor, classId);
  return fetchClassStudents(classId);
}

export async function countStudentsInClass(
  actor: SessionUser,
  classId: string,
): Promise<number> {
  await getClassForActor(actor, classId);
  return countQuery(
    usersCol().where("role", "==", "student").where("classId", "==", classId),
  );
}

/**
 * Admin assigns the set of classes a teacher manages. Two-way sync: the
 * teacher's `assignedClassIds` and each class's `teacherIds`.
 */
export async function assignTeacherClasses(
  actor: SessionUser,
  input: AssignTeacherClassesInput,
): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new ClassesServiceError("Only admins can assign classes to teachers.", 403);
  }

  await adminDb().runTransaction(async (tx) => {
    const teacherSnap = await tx.get(userDoc(input.teacherId));
    if (!teacherSnap.exists) throw new ClassesServiceError("Teacher not found.", 404);
    const teacher = teacherSnap.data()!;
    if (teacher.role !== "teacher") {
      throw new ClassesServiceError("That user is not a teacher.", 400);
    }
    if (actor.role === "admin") {
      if (!actor.schoolId || teacher.schoolId !== actor.schoolId) {
        throw new ClassesServiceError("This teacher belongs to another school.", 403);
      }
    } else if (teacher.schoolId == null) {
      throw new ClassesServiceError("This teacher is not part of a school.", 400);
    }

    const previous = new Set(teacher.assignedClassIds ?? []);
    const next = new Set(input.classIds);

    // ── Reads first (Firestore transactions require reads before writes) ──
    const touchedIds = [...new Set([...next, ...previous])];
    const touchedSnaps = await Promise.all(touchedIds.map((id) => tx.get(classDoc(id))));
    const touched = new Map<string, (typeof touchedSnaps)[number]>();
    touchedIds.forEach((id, i) => touched.set(id, touchedSnaps[i]!));
    for (const id of next) {
      const snap = touched.get(id)!;
      if (!snap.exists) {
        throw new ClassesServiceError(`Class not found: ${id}.`, 404);
      }
      if (snap.data()!.schoolId !== teacher.schoolId) {
        throw new ClassesServiceError("A selected class belongs to another school.", 403);
      }
    }

    // ── Writes ──
    const now = FieldValue.serverTimestamp();
    tx.update(teacherSnap.ref, {
      assignedClassIds: [...next],
      updatedAt: now,
    });

    // Two-way bookkeeping: add to newly assigned, remove from unassigned.
    for (const id of next) {
      if (previous.has(id)) continue;
      tx.update(classDoc(id), {
        teacherIds: [...new Set([...(touched.get(id)!.data()!.teacherIds ?? []), input.teacherId])],
        updatedAt: now,
      });
    }
    for (const id of previous) {
      if (next.has(id) || !touched.get(id)!.exists) continue;
      tx.update(classDoc(id), {
        teacherIds: (touched.get(id)!.data()!.teacherIds ?? []).filter(
          (t) => t !== input.teacherId,
        ),
        updatedAt: now,
      });
    }
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "class.teacher_assigned",
    targetType: "user",
    targetId: input.teacherId,
    meta: { classIds: input.classIds },
  });
}

/**
 * Admin grants or revokes a teacher's right to create missing classes and
 * claim unassigned ones. Takes effect immediately (checked live against the
 * teacher doc, not session claims).
 */
export async function setTeacherCanCreateClasses(
  actor: SessionUser,
  input: SetTeacherCanCreateClassesInput,
): Promise<void> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new ClassesServiceError("Only admins can manage class creation rights.", 403);
  }
  const snap = await userDoc(input.teacherId).get();
  if (!snap.exists) throw new ClassesServiceError("Teacher not found.", 404);
  const teacher = snap.data()!;
  if (teacher.role !== "teacher") {
    throw new ClassesServiceError("That user is not a teacher.", 400);
  }
  if (actor.role === "admin") {
    if (!actor.schoolId || teacher.schoolId !== actor.schoolId) {
      throw new ClassesServiceError("This teacher belongs to another school.", 403);
    }
  }

  await userDoc(input.teacherId).update({
    canCreateClasses: input.canCreateClasses,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "teacher.can_create_classes",
    targetType: "user",
    targetId: input.teacherId,
    meta: { canCreateClasses: input.canCreateClasses },
  });
}

/** Whether the acting teacher manages the given class (admins always do). */
export function canManageClass(actor: SessionUser, cls: WithId<ClassDoc>): boolean {
  if (actor.role === "admin" || actor.role === "super_admin") return true;
  if (actor.role !== "teacher") return false;
  return (cls.teacherIds ?? []).includes(actor.uid);
}
