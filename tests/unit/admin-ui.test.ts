import { describe, expect, it } from "vitest";

import {
  ADMIN_AVATAR_COLORS,
  filterTeachers,
  getAvatarColor,
  getInitials,
  getSchoolProfileCompleteness,
  isConsumptionTransaction,
  isCreditTransaction,
  isSchoolAdminWorkspace,
} from "@/lib/admin-ui";

describe("ADMIN_AVATAR_COLORS", () => {
  it("keeps palette order stable (avatar colors are user-visible)", () => {
    expect(ADMIN_AVATAR_COLORS).toEqual([
      "bg-violet-500",
      "bg-blue-500",
      "bg-cyan-500",
      "bg-emerald-500",
      "bg-orange-500",
      "bg-pink-500",
      "bg-indigo-500",
      "bg-teal-500",
    ]);
  });
});

describe("getInitials", () => {
  it("returns two-letter initials for full names", () => {
    expect(getInitials("Mary Atieno")).toBe("MA");
    expect(getInitials("  john   doe  ")).toBe("JD");
  });

  it("handles single names and blank input", () => {
    expect(getInitials("Madonna")).toBe("MA");
    expect(getInitials("A")).toBe("A");
    expect(getInitials("   ")).toBe("?");
  });
});

describe("getAvatarColor", () => {
  it("is deterministic per id and stays within the palette", () => {
    expect(getAvatarColor("student-1")).toBe(getAvatarColor("student-1"));
    expect(getAvatarColor("student-1")).toMatch(/^bg-/);
  });

  it("distributes different ids (spot check)", () => {
    const colors = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(getAvatarColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("filterTeachers", () => {
  const teachers = [
    { displayName: "Mary Atieno", email: "mary@school.ac.ug" },
    { displayName: "John Kamau", email: "jkamau@example.com" },
    { displayName: null, email: "no-name@school.ac.ug" },
  ];

  it("returns all teachers on blank query without mutating input", () => {
    const out = filterTeachers(teachers, "   ");
    expect(out).toHaveLength(3);
    expect(out).not.toBe(teachers);
  });

  it("matches name and email case-insensitively", () => {
    expect(filterTeachers(teachers, "mary")).toHaveLength(1);
    expect(filterTeachers(teachers, "JKAMAU")).toHaveLength(1);
    expect(filterTeachers(teachers, "school.ac.ug")).toHaveLength(2);
  });

  it("returns empty when nothing matches", () => {
    expect(filterTeachers(teachers, "zzz")).toHaveLength(0);
  });
});

describe("getSchoolProfileCompleteness", () => {
  it("scores a complete profile at 100% with no missing fields", () => {
    const result = getSchoolProfileCompleteness({
      name: "Bridge Academy",
      motto: "Learn",
      phone: "0700",
      email: "hi@school.ac.ug",
      address: "Kampala",
      registrationNumber: "PSS/2019/014",
      description: "A school",
    });
    expect(result).toEqual({
      completed: 7,
      total: 7,
      percent: 100,
      missing: [],
    });
  });

  it("lists missing labels and rounds the percent", () => {
    const result = getSchoolProfileCompleteness({
      name: "Bridge Academy",
      motto: "",
      phone: null,
      email: "hi@school.ac.ug",
      address: "  ",
      registrationNumber: "PSS/2019/014",
      description: undefined,
    });
    expect(result.completed).toBe(3);
    expect(result.total).toBe(7);
    expect(result.percent).toBe(43);
    expect(result.missing).toEqual([
      "Motto",
      "Phone",
      "Address",
      "Description",
    ]);
  });
});

describe("isSchoolAdminWorkspace", () => {
  it("gates onboarding to school admins with a schoolId", () => {
    expect(isSchoolAdminWorkspace({ role: "admin", schoolId: "s1" })).toBe(true);
    expect(isSchoolAdminWorkspace({ role: "admin", schoolId: null })).toBe(false);
    expect(isSchoolAdminWorkspace({ role: "admin" })).toBe(false);
    expect(isSchoolAdminWorkspace({ role: "teacher", schoolId: "s1" })).toBe(false);
    expect(isSchoolAdminWorkspace({ role: "super_admin", schoolId: "s1" })).toBe(false);
  });
});

describe("ledger direction predicates", () => {
  it("counts token deductions and zero-token voice consumption", () => {
    expect(isConsumptionTransaction({ type: "consumption", tokensDelta: -100 })).toBe(true);
    // Voice sessions bill by minutes: tokensDelta 0 but still consumption.
    expect(isConsumptionTransaction({ type: "consumption", tokensDelta: 0 })).toBe(true);
    // Negative adjustments are outflows even though their type differs.
    expect(isConsumptionTransaction({ type: "adjustment", tokensDelta: -50 })).toBe(true);
    expect(isConsumptionTransaction({ type: "topup", tokensDelta: 100 })).toBe(false);
    expect(isConsumptionTransaction({ type: "adjustment", tokensDelta: 50 })).toBe(false);
  });

  it("keeps zero-token consumption out of credits", () => {
    expect(isCreditTransaction({ type: "topup", tokensDelta: 100 })).toBe(true);
    expect(isCreditTransaction({ type: "refund", tokensDelta: 100 })).toBe(true);
    expect(isCreditTransaction({ type: "adjustment", tokensDelta: 50 })).toBe(true);
    expect(isCreditTransaction({ type: "consumption", tokensDelta: 0 })).toBe(false);
    expect(isCreditTransaction({ type: "consumption", tokensDelta: -100 })).toBe(false);
  });
});
