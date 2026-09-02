import { describe, expect, it } from "vitest";

import {
  acceptInviteSchema,
  createClassesSchema,
  createSelfSchoolSchema,
  createTopupSchema,
  createTeacherInviteSchema,
  validClassLevelsFor,
} from "@/lib/schemas/school";
import { createStudentSchema, createSchoolSchema } from "@/lib/schemas/users";
import { generateExamSchema } from "@/lib/schemas/exam";

describe("createSelfSchoolSchema", () => {
  const base = { name: "Kampala Primary", level: "primary" as const };

  it("accepts a primary school with its level", () => {
    const parsed = createSelfSchoolSchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("requires the level — a school is primary OR secondary, never both", () => {
    const parsed = createSelfSchoolSchema.safeParse({ name: "X School" });
    expect(parsed.success).toBe(false);
  });

  it("only allows primary/secondary levels", () => {
    const parsed = createSelfSchoolSchema.safeParse({ name: "X", level: "nursery" });
    expect(parsed.success).toBe(false);
  });

  it("normalizes empty optional text fields to null", () => {
    const parsed = createSelfSchoolSchema.parse({ ...base, motto: "  " });
    expect(parsed.motto).toBeNull();
  });
});

describe("createClassesSchema", () => {
  it("requires at least one class", () => {
    const parsed = createClassesSchema.safeParse({ classLevels: [] });
    expect(parsed.success).toBe(false);
  });

  it("coerces form-string class levels", () => {
    const parsed = createClassesSchema.parse({ classLevels: ["1", 2] });
    expect(parsed.classLevels).toEqual([1, 2]);
  });
});

describe("createTopupSchema", () => {
  it("accepts pack-sized amounts", () => {
    const parsed = createTopupSchema.parse({ tokens: "100000" });
    expect(parsed.tokens).toBe(100_000);
  });

  it("rejects amounts below the minimum", () => {
    const parsed = createTopupSchema.safeParse({ tokens: 999 });
    expect(parsed.success).toBe(false);
  });

  it("rejects typo-sized amounts", () => {
    const parsed = createTopupSchema.safeParse({ tokens: 500_000_000 });
    expect(parsed.success).toBe(false);
  });
});

describe("createTeacherInviteSchema", () => {
  it("defaults classIds to empty", () => {
    const parsed = createTeacherInviteSchema.parse({ email: "t@s.ac.ug" });
    expect(parsed.classIds).toEqual([]);
  });

  it("requires a valid email", () => {
    const parsed = createTeacherInviteSchema.safeParse({ email: "nope" });
    expect(parsed.success).toBe(false);
  });
});

describe("acceptInviteSchema", () => {
  const base = {
    token: "a-very-long-invite-token",
    displayName: "Jane Teacher",
    password: "GoodPass1word",
  };

  it("accepts a complete submission", () => {
    expect(acceptInviteSchema.safeParse(base).success).toBe(true);
  });

  it("enforces password complexity", () => {
    const parsed = acceptInviteSchema.safeParse({ ...base, password: "alllowercase1" });
    expect(parsed.success).toBe(false);
  });
});

describe("createStudentSchema with class membership", () => {
  it("skips level/class checks when joining a class", () => {
    const parsed = createStudentSchema.safeParse({
      displayName: "New Student",
      email: "s@s.ac.ug",
      password: "GoodPass1word",
      classId: "class_1",
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires level/class for unassigned students", () => {
    const parsed = createStudentSchema.safeParse({
      displayName: "New Student",
      email: "s@s.ac.ug",
      password: "GoodPass1word",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createSchoolSchema (super admin) requires level", () => {
  it("rejects a school without a level", () => {
    const parsed = createSchoolSchema.safeParse({
      schoolName: "Test",
      ownerName: "Owner",
      ownerEmail: "o@s.ac.ug",
      ownerPassword: "GoodPass1word",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a school with a level", () => {
    const parsed = createSchoolSchema.safeParse({
      schoolName: "Test",
      level: "secondary",
      ownerName: "Owner",
      ownerEmail: "o@s.ac.ug",
      ownerPassword: "GoodPass1word",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("generateExamSchema deadline + class", () => {
  it("accepts an optional ISO deadline and classId", () => {
    const parsed = generateExamSchema.safeParse({
      params: {
        subject: "mathematics",
        level: "primary",
        secondarySubLevel: null,
        classLevel: 3,
        topic: "Fractions",
        difficulty: "easy",
        durationMinutes: 30,
        questionCount: 5,
        questionTypes: ["multiple_choice"],
        includeHints: true,
        includeExplanations: true,
        includeWorkedExamples: false,
        instructions: null,
        preventBacktrack: true,
        allowReviewBeforeSubmit: false,
        allowSkipping: true,
        requireFullscreen: true,
        enableCameraRecording: false,
        enableScreenRecording: false,
      },
      classId: "class_1",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe("validClassLevelsFor", () => {
  it("returns P1–P7 for primary", () => {
    expect(validClassLevelsFor("primary")).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("returns S1–S6 for secondary", () => {
    expect(validClassLevelsFor("secondary")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("splits secondary by sub-level", () => {
    expect(validClassLevelsFor("secondary", "o_level")).toEqual([1, 2, 3, 4]);
    expect(validClassLevelsFor("secondary", "a_level")).toEqual([5, 6]);
  });
});
