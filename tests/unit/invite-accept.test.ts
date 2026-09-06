import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminAuth, invitesCol, userDoc, classDoc, schoolDoc } = vi.hoisted(() => ({
  adminAuth: vi.fn(),
  invitesCol: vi.fn(),
  userDoc: vi.fn(),
  classDoc: vi.fn(),
  schoolDoc: vi.fn(),
}));

vi.mock("@/server/firebase/admin", () => ({ adminAuth }));
vi.mock("@/server/firebase/collections", () => ({
  invitesCol,
  userDoc,
  classDoc,
  schoolDoc,
}));
vi.mock("@/server/services/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/services/email", () => ({
  appUrl: vi.fn((p: string) => `https://test${p}`),
  sendTemplateEmail: vi.fn(),
}));
vi.mock("@/emails/templates", () => ({
  TeacherInviteEmail: () => null,
  InviteRevokedEmail: () => null,
}));

import { acceptTeacherInvite, createTeacherInvite } from "@/server/services/invites";
import type { SessionUser } from "@/server/auth/session";

const adminActor: SessionUser = {
  uid: "admin-1",
  email: "admin@school.test",
  displayName: "Admin",
  role: "admin",
  schoolId: "school-1",
  status: "active",
};

let currentInvite: Record<string, unknown>;
let inviteQueryResult: { empty: boolean; docs: Array<{ id: string; data: () => unknown }> };
const setTeacher = vi.fn();
const updateInvite = vi.fn();
const updateSchool = vi.fn();
const addInvite = vi.fn();

function invite(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schoolId: "school-1",
    schoolName: "Test School",
    email: "teacher@school.test",
    role: "teacher",
    classIds: [],
    status: "pending",
    invitedBy: "admin-1",
    invitedByName: "Admin",
    expiresAt: { toMillis: () => Date.now() + 86_400_000 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentInvite = invite();
  inviteQueryResult = {
    empty: false,
    docs: [{ id: "inv-1", data: () => currentInvite }],
  };
  adminAuth.mockReturnValue({
    getUserByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ uid: "teacher-new" }),
    setCustomUserClaims: vi.fn().mockResolvedValue(undefined),
  });
  // Self-chaining: supports both the single-where token lookup and the
  // triple-where pending-dupe check.
  const chain = {
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.where.mockReturnValue(chain);
  chain.limit.mockReturnValue({ get: vi.fn(async () => inviteQueryResult) });
  invitesCol.mockReturnValue({
    where: chain.where,
    limit: chain.limit,
    doc: vi.fn().mockReturnValue({ update: updateInvite }),
    add: addInvite,
  });
  userDoc.mockReturnValue({ set: setTeacher });
  schoolDoc.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ name: "Test School", level: "primary" }),
    }),
    update: updateSchool,
  });
});

describe("acceptTeacherInvite class-creation privilege", () => {
  it("applies a granted invite flag to the new teacher doc", async () => {
    currentInvite = invite({ canCreateClasses: true });

    await acceptTeacherInvite({
      token: "raw-token",
      displayName: "New Teacher",
      password: "GoodPass1word",
    });

    expect(setTeacher).toHaveBeenCalledTimes(1);
    expect(setTeacher.mock.calls[0]![0]).toMatchObject({ canCreateClasses: true });
  });

  it("denies by default when the box was not ticked", async () => {
    currentInvite = invite({ canCreateClasses: false });

    await acceptTeacherInvite({
      token: "raw-token",
      displayName: "New Teacher",
      password: "GoodPass1word",
    });

    expect(setTeacher.mock.calls[0]![0]).toMatchObject({ canCreateClasses: false });
  });

  it("fails closed for pre-privilege invites without the flag", async () => {
    currentInvite = invite();
    delete currentInvite.canCreateClasses;

    await acceptTeacherInvite({
      token: "raw-token",
      displayName: "New Teacher",
      password: "GoodPass1word",
    });

    expect(setTeacher.mock.calls[0]![0]).toMatchObject({ canCreateClasses: false });
  });
});

describe("createTeacherInvite privilege flag", () => {
  beforeEach(() => {
    // No pending dupe for the invited email.
    inviteQueryResult = { empty: true, docs: [] };
    addInvite.mockResolvedValue({
      id: "inv-new",
      get: vi.fn(async () => ({ data: () => ({}) })),
    });
  });

  it("persists a granted flag on the invite", async () => {
    await createTeacherInvite(adminActor, {
      email: "Teacher@School.Test",
      classIds: [],
      canCreateClasses: true,
    });

    expect(addInvite).toHaveBeenCalledTimes(1);
    expect(addInvite.mock.calls[0]![0]).toMatchObject({
      email: "teacher@school.test",
      canCreateClasses: true,
      status: "pending",
    });
  });

  it("persists an explicitly denied flag", async () => {
    await createTeacherInvite(adminActor, {
      email: "t2@school.test",
      classIds: [],
      canCreateClasses: false,
    });

    expect(addInvite.mock.calls[0]![0]).toMatchObject({ canCreateClasses: false });
  });
});
