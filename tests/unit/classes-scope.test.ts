import { beforeEach, describe, expect, it, vi } from "vitest";

const { classesBySchool, schoolDoc, userDoc, classesCol } = vi.hoisted(() => ({
  classesBySchool: vi.fn(),
  schoolDoc: vi.fn(),
  userDoc: vi.fn(),
  classesCol: vi.fn(),
}));

const { canTeacherCreateClasses } = vi.hoisted(() => ({
  canTeacherCreateClasses: vi.fn(),
}));

vi.mock("@/server/firebase/collections", () => ({
  classesBySchool,
  schoolDoc,
  userDoc,
  classesCol,
  // Present so the service module still links; only the above are exercised.
  classDoc: vi.fn(),
  countQuery: vi.fn(),
  usersCol: vi.fn(),
  auditLogsCol: vi.fn(),
}));

vi.mock("@/server/firebase/admin", () => ({
  adminDb: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn(),
}));

vi.mock("@/server/services/users", () => ({
  canTeacherCreateClasses,
}));

import { adminDb } from "@/server/firebase/admin";
import { writeAudit } from "@/server/services/audit";
import {
  createClasses,
  listClasses,
  setTeacherCanCreateClasses,
  ClassesServiceError,
} from "@/server/services/classes";
import type { SessionUser } from "@/server/auth/session";

function actor(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    uid: "teacher-1",
    email: "teacher@school.test",
    displayName: "Test Teacher",
    role: "teacher",
    schoolId: "school-1",
    status: "active",
    ...overrides,
  };
}

function classDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

function schoolSnapshot() {
  return {
    docs: [
      // Deliberately out of order — listClasses must sort by class year.
      classDoc("c-s4", { classLevel: 4, level: "secondary", teacherIds: ["teacher-1"] }),
      classDoc("c-s1", { classLevel: 1, level: "secondary", teacherIds: ["other-teacher"] }),
      classDoc("c-s2", { classLevel: 2, level: "secondary", teacherIds: ["teacher-1", "other-teacher"] }),
      classDoc("c-s3", { classLevel: 3, level: "secondary" }),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  classesBySchool.mockReturnValue({
    get: vi.fn().mockResolvedValue(schoolSnapshot()),
  });
});

describe("listClasses teacher scoping", () => {
  it("returns only classes assigned to the teacher, ordered by class year", async () => {
    const classes = await listClasses(actor());

    expect(classesBySchool).toHaveBeenCalledWith("school-1");
    expect(classes.map((c) => c.id)).toEqual(["c-s2", "c-s4"]);
  });

  it("excludes classes with no teacher roster", async () => {
    const classes = await listClasses(actor());

    expect(classes.some((c) => c.id === "c-s3")).toBe(false);
  });

  it("returns every class for admins", async () => {
    const classes = await listClasses(actor({ uid: "admin-1", role: "admin" }));

    expect(classes.map((c) => c.id)).toEqual(["c-s1", "c-s2", "c-s3", "c-s4"]);
  });

  it("returns nothing without a school", async () => {
    const classes = await listClasses(actor({ schoolId: null }));

    expect(classes).toEqual([]);
    expect(classesBySchool).not.toHaveBeenCalled();
  });
});

async function errorOf(promise: Promise<unknown>): Promise<ClassesServiceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ClassesServiceError) return err;
    throw new Error(`expected ClassesServiceError, got ${String(err)}`);
  }
  throw new Error("expected rejection, got success");
}

describe("createClasses teacher privilege gate", () => {
  const teacher = actor();

  function primarySchool() {
    return { exists: true, data: () => ({ level: "primary" }) };
  }

  beforeEach(() => {
    schoolDoc.mockReturnValue({ get: vi.fn().mockResolvedValue(primarySchool()) });
    classesCol.mockReturnValue({ doc: vi.fn().mockReturnValue({ id: "new-class-1" }) });
  });

  it("denies teachers without the privilege before touching Firestore writes", async () => {
    canTeacherCreateClasses.mockResolvedValue(false);

    const err = await errorOf(createClasses(teacher, { classLevels: [1] }));

    expect(err.status).toBe(403);
    expect(err.message).toMatch(/admin/i);
    expect(adminDb).not.toHaveBeenCalled();
  });

  it("lets privileged teachers create (and auto-claim) missing classes", async () => {
    canTeacherCreateClasses.mockResolvedValue(true);
    const txCreate = vi.fn();
    const txUpdate = vi.fn();
    vi.mocked(adminDb).mockReturnValue({
      runTransaction: vi.fn((fn: (tx: unknown) => unknown) =>
        fn({
          get: vi.fn((ref: unknown) => {
            // Transaction reads: existing classes (none) then the teacher doc.
            // Identity holds because the mock returns the same object on every
            // call — if the mock ever returns fresh objects, compare by shape.
            if (ref === classesBySchool("school-1")) {
              return Promise.resolve({ docs: [] });
            }
            return Promise.resolve({
              exists: true,
              ref: {},
              data: () => ({ assignedClassIds: [] }),
            });
          }),
          create: txCreate,
          update: txUpdate,
        }),
      ),
    } as unknown as ReturnType<typeof adminDb>);

    const created = await createClasses(teacher, { classLevels: [1] });

    expect(created).toHaveLength(1);
    expect(created[0]!.id).toBe("new-class-1");
    expect(txCreate).toHaveBeenCalledTimes(1);
  });

  it("never gates admins", async () => {
    const err = await errorOf(
      createClasses(actor({ uid: "admin-1", role: "admin" }), { classLevels: [99] }),
    );

    // Sails past the privilege gate into level validation.
    expect(err.status).toBe(400);
    expect(canTeacherCreateClasses).not.toHaveBeenCalled();
  });
});

describe("setTeacherCanCreateClasses", () => {
  const admin = actor({ uid: "admin-1", role: "admin" });
  const updateTeacher = vi.fn();

  function teacherDoc(data: Record<string, unknown> | null) {
    if (data === null) return { exists: false };
    return {
      exists: true,
      data: () => data,
      // Only exercised on the happy path.
      ref: {},
    };
  }

  beforeEach(() => {
    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(
        teacherDoc({ role: "teacher", schoolId: "school-1" }),
      ),
      update: updateTeacher,
    });
  });

  it("rejects non-admin callers", async () => {
    const err = await errorOf(
      setTeacherCanCreateClasses(actor(), { teacherId: "t-2", canCreateClasses: true }),
    );

    expect(err.status).toBe(403);
    expect(updateTeacher).not.toHaveBeenCalled();
  });

  it("rejects unknown users and non-teachers", async () => {
    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(teacherDoc(null)),
      update: updateTeacher,
    });
    await expect(
      errorOf(setTeacherCanCreateClasses(admin, { teacherId: "ghost", canCreateClasses: true })),
    ).resolves.toMatchObject({ status: 404 });

    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(teacherDoc({ role: "student", schoolId: "school-1" })),
      update: updateTeacher,
    });
    await expect(
      errorOf(setTeacherCanCreateClasses(admin, { teacherId: "s-1", canCreateClasses: true })),
    ).resolves.toMatchObject({ status: 400 });
    expect(updateTeacher).not.toHaveBeenCalled();
  });

  it("confines admins to their own school", async () => {
    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(teacherDoc({ role: "teacher", schoolId: "other-school" })),
      update: updateTeacher,
    });

    const err = await errorOf(
      setTeacherCanCreateClasses(admin, { teacherId: "t-2", canCreateClasses: true }),
    );

    expect(err.status).toBe(403);
    expect(updateTeacher).not.toHaveBeenCalled();
  });

  it("grants and revokes with an audit trail", async () => {
    await setTeacherCanCreateClasses(admin, { teacherId: "t-2", canCreateClasses: true });
    expect(updateTeacher).toHaveBeenCalledWith(
      expect.objectContaining({ canCreateClasses: true }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "teacher.can_create_classes",
        targetId: "t-2",
        meta: { canCreateClasses: true },
      }),
    );

    vi.clearAllMocks();
    await setTeacherCanCreateClasses(admin, { teacherId: "t-2", canCreateClasses: false });
    expect(updateTeacher).toHaveBeenCalledWith(
      expect.objectContaining({ canCreateClasses: false }),
    );
  });

  it("lets super admins manage any school's teachers", async () => {
    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(teacherDoc({ role: "teacher", schoolId: "other-school" })),
      update: updateTeacher,
    });

    await setTeacherCanCreateClasses(
      actor({ uid: "super-1", role: "super_admin", schoolId: null }),
      { teacherId: "t-2", canCreateClasses: true },
    );

    expect(updateTeacher).toHaveBeenCalledTimes(1);
  });
});
