import { beforeEach, describe, expect, it, vi } from "vitest";

const { classDoc, schoolDoc } = vi.hoisted(() => ({
  classDoc: vi.fn(),
  schoolDoc: vi.fn(),
}));

vi.mock("@/server/firebase/collections", () => ({
  classDoc,
  schoolDoc,
}));

import { resolveExamClassId } from "@/server/services/exams/scope";
import { ExamsServiceError } from "@/server/services/exams/errors";
import type { SessionUser } from "@/server/auth/session";
import type { GenerateExamInput } from "@/lib/schemas/exam";

function actor(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    uid: "teacher-1",
    email: "staff@school.test",
    displayName: "Staff Member",
    role: "teacher",
    schoolId: "school-1",
    status: "active",
    ...overrides,
  };
}

function input(
  overrides: Partial<GenerateExamInput> = {},
  params: Record<string, unknown> = {},
): GenerateExamInput {
  return {
    classId: undefined,
    documentIds: [],
    expiresAt: undefined,
    params: {
      level: "secondary",
      classLevel: 4,
      ...params,
    },
    ...overrides,
  } as unknown as GenerateExamInput;
}

function classSnap(data: Record<string, unknown> | null) {
  return { exists: data !== null, data: () => data };
}

const managedClass = {
  schoolId: "school-1",
  level: "secondary",
  classLevel: 4,
  teacherIds: ["teacher-1"],
};

beforeEach(() => {
  vi.clearAllMocks();
  classDoc.mockImplementation(() => ({ get: vi.fn().mockResolvedValue(classSnap(managedClass)) }));
  schoolDoc.mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(classSnap({ level: "secondary" })),
  }));
});

async function errorOf(promise: Promise<unknown>): Promise<ExamsServiceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ExamsServiceError) return err;
    throw new Error(`expected ExamsServiceError, got ${String(err)}`);
  }
  throw new Error("expected rejection, got success");
}

describe("resolveExamClassId", () => {
  it("returns the class for a teacher assigned to it", async () => {
    await expect(
      resolveExamClassId(actor(), input({ classId: "class-1" })),
    ).resolves.toBe("class-1");
  });

  it("rejects a teacher unassigned to the class", async () => {
    classDoc.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(classSnap({ ...managedClass, teacherIds: ["other"] })),
    }));
    const err = await errorOf(resolveExamClassId(actor(), input({ classId: "class-1" })));
    expect(err.status).toBe(403);
  });

  it("requires a class for class-less teachers", async () => {
    const err = await errorOf(resolveExamClassId(actor(), input()));
    expect(err.status).toBe(403);
    expect(classDoc).not.toHaveBeenCalled();
  });

  it("returns the class for a school admin", async () => {
    await expect(
      resolveExamClassId(actor({ uid: "admin-1", role: "admin" }), input({ classId: "class-1" })),
    ).resolves.toBe("class-1");
  });

  it("rejects a class-scoped school admin without a school", async () => {
    const err = await errorOf(
      resolveExamClassId(
        actor({ uid: "admin-1", role: "admin", schoolId: null }),
        input({ classId: "class-1" }),
      ),
    );
    expect(err.status).toBe(403);
    expect(classDoc).not.toHaveBeenCalled();
  });

  it("requires a class for class-less school admins", async () => {
    const err = await errorOf(
      resolveExamClassId(actor({ uid: "admin-1", role: "admin" }), input()),
    );
    expect(err.status).toBe(403);
  });

  it("returns null for class-less super admins without touching Firestore", async () => {
    await expect(
      resolveExamClassId(actor({ role: "super_admin", schoolId: null }), input()),
    ).resolves.toBeNull();
    expect(classDoc).not.toHaveBeenCalled();
    expect(schoolDoc).not.toHaveBeenCalled();
  });

  it("rejects a class-less call crossing the school level", async () => {
    // Only reachable with a school set but no class rule — e.g. a super
    // admin carrying a schoolId. School-less actors skip the check: there is
    // no school level to cross.
    const err = await errorOf(
      resolveExamClassId(
        actor({ role: "super_admin", schoolId: "school-1" }),
        input({}, { level: "primary", classLevel: 2 }),
      ),
    );
    expect(err.status).toBe(400);
  });

  it("404s on a missing class", async () => {
    classDoc.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(classSnap(null)),
    }));
    const err = await errorOf(resolveExamClassId(actor(), input({ classId: "gone" })));
    expect(err.status).toBe(404);
  });

  it("403s on a class from another school", async () => {
    classDoc.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(classSnap({ ...managedClass, schoolId: "other-school" })),
    }));
    const err = await errorOf(resolveExamClassId(actor(), input({ classId: "class-1" })));
    expect(err.status).toBe(403);
  });

  it("400s when the exam scope does not match the class", async () => {
    const err = await errorOf(
      resolveExamClassId(actor(), input({ classId: "class-1" }, { level: "primary", classLevel: 2 })),
    );
    expect(err.status).toBe(400);
  });
});
