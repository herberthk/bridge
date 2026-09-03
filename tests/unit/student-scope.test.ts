import { beforeEach, describe, expect, it, vi } from "vitest";

const { classDoc } = vi.hoisted(() => ({ classDoc: vi.fn() }));

vi.mock("@/server/firebase/collections", () => ({
  classDoc,
  schoolsCol: vi.fn(),
  userDoc: vi.fn(),
  usersCol: vi.fn(),
  auditLogsCol: vi.fn(),
}));

vi.mock("@/server/firebase/admin", () => ({
  adminAuth: vi.fn(),
}));

vi.mock("@/server/services/email", () => ({
  appUrl: vi.fn(),
  sendTemplateEmail: vi.fn(),
}));

import { createStudent } from "@/server/services/users";
import { UsersServiceError } from "@/server/services/users";
import type { SessionUser } from "@/server/auth/session";
import type { CreateStudentInput } from "@/lib/schemas/users";

function actor(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    uid: "staff-1",
    email: "staff@school.test",
    displayName: "Staff Member",
    role: "teacher",
    schoolId: "school-1",
    status: "active",
    ...overrides,
  };
}

function input(overrides: Partial<CreateStudentInput> = {}): CreateStudentInput {
  return {
    displayName: "New Student",
    email: "new@student.test",
    password: "TempPass1234",
    classId: undefined,
    level: undefined,
    secondarySubLevel: null,
    classLevel: undefined,
    schoolId: undefined,
    ...overrides,
  };
}

function classSnap(data: Record<string, unknown> | null) {
  return { exists: data !== null, data: () => data };
}

async function errorOf(promise: Promise<unknown>): Promise<UsersServiceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UsersServiceError) return err;
    throw new Error(`expected UsersServiceError, got ${String(err)}`);
  }
  throw new Error("expected rejection, got success");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createStudent class scoping", () => {
  it("requires a class for class-less teachers without touching Firestore", async () => {
    const err = await errorOf(createStudent(actor(), input()));
    expect(err.status).toBe(403);
    expect(classDoc).not.toHaveBeenCalled();
  });

  it("requires a class for class-less school admins", async () => {
    const err = await errorOf(createStudent(actor({ role: "admin" }), input()));
    expect(err.status).toBe(403);
    expect(classDoc).not.toHaveBeenCalled();
  });

  it("rejects a teacher unassigned to the class", async () => {
    classDoc.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(
        classSnap({ schoolId: "school-1", level: "secondary", classLevel: 4, secondarySubLevel: "o_level", teacherIds: ["other-teacher"] }),
      ),
    }));
    const err = await errorOf(createStudent(actor(), input({ classId: "class-1" })));
    expect(err.status).toBe(403);
  });

  it("rejects a class from another school", async () => {
    classDoc.mockImplementation(() => ({
      get: vi.fn().mockResolvedValue(
        classSnap({ schoolId: "other-school", level: "secondary", classLevel: 4, secondarySubLevel: "o_level", teacherIds: ["staff-1"] }),
      ),
    }));
    const err = await errorOf(
      createStudent(actor({ role: "admin" }), input({ classId: "class-1" })),
    );
    expect(err.status).toBe(403);
  });
});
