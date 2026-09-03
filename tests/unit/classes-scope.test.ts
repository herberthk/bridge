import { beforeEach, describe, expect, it, vi } from "vitest";

const { classesBySchool } = vi.hoisted(() => ({ classesBySchool: vi.fn() }));

vi.mock("@/server/firebase/collections", () => ({
  classesBySchool,
  // Present so sibling service modules that import this module still link;
  // only `classesBySchool` is exercised here.
  auditLogsCol: vi.fn(),
}));

vi.mock("@/server/firebase/admin", () => ({
  adminDb: vi.fn(),
}));

import { listClasses } from "@/server/services/classes";
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
