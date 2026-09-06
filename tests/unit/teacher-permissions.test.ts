import { beforeEach, describe, expect, it, vi } from "vitest";

const { userDoc } = vi.hoisted(() => ({ userDoc: vi.fn() }));

vi.mock("@/server/firebase/collections", () => ({ userDoc }));
vi.mock("@/server/firebase/admin", () => ({ adminAuth: vi.fn() }));
vi.mock("@/server/services/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/services/email", () => ({
  appUrl: vi.fn(),
  sendTemplateEmail: vi.fn(),
}));
vi.mock("@/emails/templates", () => ({
  StudentInviteEmail: () => null,
  BanNoticeEmail: () => null,
}));

import { canTeacherCreateClasses } from "@/server/services/users";

function teacherSnap(data: Record<string, unknown> | null) {
  if (data === null) return { exists: false };
  return { exists: true, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canTeacherCreateClasses", () => {
  it("allows an explicitly granted teacher", async () => {
    userDoc.mockReturnValue({ get: vi.fn().mockResolvedValue(teacherSnap({ canCreateClasses: true })) });

    await expect(canTeacherCreateClasses("t-1")).resolves.toBe(true);
    expect(userDoc).toHaveBeenCalledWith("t-1");
  });

  it("denies an explicitly revoked teacher", async () => {
    userDoc.mockReturnValue({ get: vi.fn().mockResolvedValue(teacherSnap({ canCreateClasses: false })) });

    await expect(canTeacherCreateClasses("t-1")).resolves.toBe(false);
  });

  it("allows legacy teachers without the flag so they keep their rights", async () => {
    userDoc.mockReturnValue({ get: vi.fn().mockResolvedValue(teacherSnap({})) });

    await expect(canTeacherCreateClasses("t-1")).resolves.toBe(true);
  });

  it("treats null like a missing flag (allowed)", async () => {
    userDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue(teacherSnap({ canCreateClasses: null })),
    });

    await expect(canTeacherCreateClasses("t-1")).resolves.toBe(true);
  });

  it("fails closed for unknown teachers and read errors", async () => {
    userDoc.mockReturnValueOnce({ get: vi.fn().mockResolvedValue(teacherSnap(null)) });
    await expect(canTeacherCreateClasses("ghost")).resolves.toBe(false);

    userDoc.mockReturnValueOnce({ get: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(canTeacherCreateClasses("t-1")).resolves.toBe(false);
  });
});
