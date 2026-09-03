import { FieldPath, type Query } from "firebase-admin/firestore";

import {
  attemptsCol,
  classDoc,
  classesBySchool,
  countQuery,
  examDoc,
  examsCol,
  schoolDoc,
  schoolsCol,
  userDoc,
  usersCol,
  walletDoc,
} from "@/server/firebase/collections";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptDoc,
  ClassDoc,
  SchoolDoc,
  UserDoc,
  WalletDoc,
  WithId,
} from "@/types/firestore";
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  namePrefixRange,
  offsetForPage,
} from "@/lib/pagination";

export class PlatformServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function assertSuper(actor: SessionUser): void {
  if (actor.role !== "super_admin") {
    throw new PlatformServiceError("Only super admins can browse the platform directory.", 403);
  }
}

function pageResult<T>(items: T[], page: number, pageSize: number, total: number): PagedResult<T> {
  const safePage = clampPage(page, total, pageSize);
  return {
    items,
    page: safePage,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(Math.max(0, total) / pageSize)),
  };
}

/**
 * Applies the directory filters + numbered pagination to a users query.
 * Search is a lexicographic "starts with" on displayName (the Firestore
 * standard); empty search keeps the createdAt ordering.
 */
async function queryDirectory(
  filters: UserDirectoryFilters,
  extra: (q: Query<UserDoc>) => Query<UserDoc>,
): Promise<{ items: WithId<UserDoc>[]; total: number }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const range = namePrefixRange(filters.search);
  let itemsQuery: Query<UserDoc>;
  let countQ: Query<UserDoc>;

  if (range) {
    // Search mode — ordered by name so the prefix range can serve the query.
    let q = extra(
      usersCol()
        .where("role", "==", filters.role)
        .where("displayName", ">=", range.start)
        .where("displayName", "<=", range.end),
    ) as Query<UserDoc>;
    if (filters.schoolId) q = q.where("schoolId", "==", filters.schoolId) as Query<UserDoc>;
    if (filters.status) q = q.where("status", "==", filters.status) as Query<UserDoc>;
    itemsQuery = q.orderBy("displayName", "asc").offset(offsetForPage(page, pageSize)).limit(pageSize);
    countQ = q;
  } else {
    let q = extra(usersCol().where("role", "==", filters.role)) as Query<UserDoc>;
    if (filters.schoolId) q = q.where("schoolId", "==", filters.schoolId) as Query<UserDoc>;
    if (filters.status) q = q.where("status", "==", filters.status) as Query<UserDoc>;
    itemsQuery = q
      .orderBy("createdAt", "desc")
      .offset(offsetForPage(page, pageSize))
      .limit(pageSize);
    countQ = q;
  }

  const [snap, total] = await Promise.all([
    itemsQuery.get(),
    countQuery(countQ),
  ]);
  return { items: snap.docs.map((d) => ({ id: d.id, ...d.data()! })), total };
}

export interface UserDirectoryFilters {
  role: "student" | "teacher" | "admin";
  search?: string | null;
  schoolId?: string | null;
  status?: string | null;
  page: number;
  pageSize?: number;
}

/** Platform-wide, paginated user directory (students / teachers / admins). */
export async function listPlatformUsers(
  actor: SessionUser,
  filters: UserDirectoryFilters,
): Promise<PagedResult<WithId<UserDoc>>> {
  assertSuper(actor);
  const pageSize = Math.min(filters.pageSize ?? DEFAULT_PAGE_SIZE, 100);
  const page = filters.page ?? 1;
  const { items, total } = await queryDirectory(
    { ...filters, page, pageSize },
    (q) => q,
  );
  return pageResult(items, page, pageSize, total);
}

/** Paged schools directory for the super admin. */
export async function listPlatformSchools(
  actor: SessionUser,
  filters: { search?: string | null; level?: string | null; verification?: string | null; page: number; pageSize?: number },
): Promise<PagedResult<WithId<SchoolDoc>>> {
  assertSuper(actor);
  const pageSize = Math.min(filters.pageSize ?? DEFAULT_PAGE_SIZE, 100);
  const page = filters.page ?? 1;
  const range = namePrefixRange(filters.search);

  let q: Query<SchoolDoc> = schoolsCol();
  if (range) {
    q = q.where("name", ">=", range.start).where("name", "<=", range.end).orderBy("name", "asc");
  } else {
    q = q.orderBy("createdAt", "desc");
  }
  if (filters.level) q = q.where("level", "==", filters.level);
  if (filters.verification) q = q.where("verification", "==", filters.verification);

  const [snap, total] = await Promise.all([
    q.offset(offsetForPage(filters.page, pageSize)).limit(pageSize).get(),
    countQuery(q),
  ]);
  return pageResult(
    snap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    page,
    pageSize,
    total,
  );
}

/** Super-admin detail for one school: profile, staff, wallet, counts. */
export async function getSuperSchoolDetail(
  actor: SessionUser,
  schoolId: string,
): Promise<{
  school: WithId<SchoolDoc>;
  admins: WithId<UserDoc>[];
  teachers: WithId<UserDoc>[];
  students: WithId<UserDoc>[];
  wallet: WithId<WalletDoc> | null;
  examCount: number;
  attemptCount: number;
}> {
  assertSuper(actor);
  const snap = await schoolDoc(schoolId).get();
  if (!snap.exists) throw new PlatformServiceError("School not found.", 404);
  const school = { id: snap.id, ...snap.data()! } as WithId<SchoolDoc>;

  const [adminsSnap, teachersSnap, studentsSnap, wallet, examCount, attemptCount] =
    await Promise.all([
      usersCol().where("role", "==", "admin").where("schoolId", "==", schoolId).get(),
      usersCol().where("role", "==", "teacher").where("schoolId", "==", schoolId).orderBy("createdAt", "desc").limit(100).get(),
      usersCol().where("role", "==", "student").where("schoolId", "==", schoolId).orderBy("createdAt", "desc").limit(100).get(),
      walletDoc(schoolId).get(),
      countQuery(examsCol().where("schoolId", "==", schoolId)),
      countQuery(attemptsCol().where("schoolId", "==", schoolId)),
    ]);

  return {
    school,
    admins: adminsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    teachers: teachersSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    students: studentsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })),
    wallet: wallet.exists ? { id: wallet.id, ...wallet.data()! } : null,
    examCount,
    attemptCount,
  };
}

/** Super-admin detail for one student — identity, school/class, performance. */
export async function getSuperStudentDetail(
  actor: SessionUser,
  studentId: string,
): Promise<{
  student: WithId<UserDoc>;
  school: WithId<SchoolDoc> | null;
  classInfo: WithId<ClassDoc> | null;
  attempts: { attempt: WithId<AttemptDoc>; examTitle: string }[];
  stats: { taken: number; graded: number; average: number | null; best: number | null };
}> {
  assertSuper(actor);
  const snap = await userDoc(studentId).get();
  if (!snap.exists) throw new PlatformServiceError("Student not found.", 404);
  const student = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;
  if (student.role !== "student") throw new PlatformServiceError("That user is not a student.", 400);

  const [schoolSnap, attemptsSnap] = await Promise.all([
    student.schoolId ? schoolDoc(student.schoolId).get().catch(() => null) : Promise.resolve(null),
    attemptsCol().where("studentId", "==", studentId).orderBy("createdAt", "desc").limit(25).get(),
  ]);

  const attemptsRaw = attemptsSnap.docs.map((d) => ({ id: d.id, ...d.data()! })) as WithId<AttemptDoc>[];
  const examTitlesArr = await Promise.all(
    [...new Set(attemptsRaw.map((a) => a.examId))].map(async (id) => {
      const s = await examDoc(id).get().catch(() => null);
      return [id, s?.exists ? s.data()!.title : "Unknown exam"] as const;
    }),
  );
  const examTitles = new Map(examTitlesArr);

  const graded = attemptsRaw.filter((a) => a.status === "graded" && a.score);
  const percentages = graded.map((a) => a.score!.percentage);

  return {
    student,
    school: schoolSnap?.exists ? { id: schoolSnap.id, ...schoolSnap.data()! } : null,
    classInfo: student.classId
      ? await classDoc(student.classId).get().then((c) => (c.exists ? { id: c.id, ...c.data()! } : null)).catch(() => null)
      : null,
    attempts: attemptsRaw.map((a) => ({
      attempt: a,
      examTitle: examTitles.get(a.examId) ?? "Unknown exam",
    })),
    stats: {
      taken: attemptsRaw.length,
      graded: graded.length,
      average: percentages.length
        ? Math.round((percentages.reduce((s, p) => s + p, 0) / percentages.length) * 10) / 10
        : null,
      best: percentages.length ? Math.round(Math.max(...percentages) * 10) / 10 : null,
    },
  };
}

/** Super-admin detail for one teacher. */
export async function getSuperTeacherDetail(
  actor: SessionUser,
  teacherId: string,
): Promise<{
  teacher: WithId<UserDoc>;
  school: WithId<SchoolDoc> | null;
  classes: WithId<ClassDoc>[];
  studentsReached: number;
  examsGenerated: number;
}> {
  assertSuper(actor);
  const snap = await userDoc(teacherId).get();
  if (!snap.exists) throw new PlatformServiceError("Teacher not found.", 404);
  const teacher = { id: snap.id, ...snap.data()! } as WithId<UserDoc>;
  if (teacher.role !== "teacher") throw new PlatformServiceError("That user is not a teacher.", 400);

  const [schoolSnap, classesSnap, examCount] = await Promise.all([
    teacher.schoolId ? schoolDoc(teacher.schoolId).get().catch(() => null) : Promise.resolve(null),
    teacher.schoolId ? classesBySchool(teacher.schoolId).get().catch(() => null) : Promise.resolve(null),
    countQuery(examsCol().where("createdBy", "==", teacherId)),
  ]);

  const allClasses = classesSnap?.docs.map((d) => ({ id: d.id, ...d.data()! })) ?? [];
  const classes = allClasses
    .filter((c) => (teacher.assignedClassIds ?? []).includes(c.id))
    .sort((a, b) => a.classLevel - b.classLevel);

  return {
    teacher,
    school: schoolSnap?.exists ? { id: schoolSnap.id, ...schoolSnap.data()! } : null,
    classes,
    studentsReached: classes.reduce((n, c) => n + (c.studentCount ?? 0), 0),
    examsGenerated: examCount,
  };
}
