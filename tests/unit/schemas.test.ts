import { describe, expect, it } from "vitest";

import {
  examOutputSchema,
  examParamsSchema,
  generateExamSchema,
  MAX_UNASSIGN_STUDENTS,
  unassignExamSchema,
} from "@/lib/schemas/exam";
import { setupSchema, loginSchema } from "@/lib/schemas/auth";
import { setUserStatusSchema } from "@/lib/schemas/users";
import { parseUserAgent } from "@/lib/user-agent";
import {
  COUNTRY_CURRICULA,
  O_LEVEL_SUBJECTS,
  A_LEVEL_SUBJECTS,
  PROCTORING,
  DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECT_LABELS,
} from "@/lib/constants";

const validParams = {
  subject: "physics",
  level: "secondary" as const,
  secondarySubLevel: "o_level" as const,
  classLevel: 3,
  subsidiary: null,
  topic: "Electromagnetism",
  difficulty: "hard" as const,
  durationMinutes: 60,
  questionCount: 25,
  questionTypes: ["multiple_choice", "essay"] as const,
  includeHints: true,
  includeExplanations: true,
  includeWorkedExamples: false,
  instructions: null,
};

describe("exam params schema", () => {
  it("accepts a valid spec", () => {
    expect(examParamsSchema.safeParse(validParams).success).toBe(true);
  });

  it("rejects a class outside the level (S8 doesn't exist)", () => {
    const result = examParamsSchema.safeParse({ ...validParams, classLevel: 8 });
    expect(result.success).toBe(false);
  });

  it("maps primary params without a sub-level", () => {
    const result = examParamsSchema.safeParse({
      ...validParams,
      level: "primary",
      secondarySubLevel: null,
      classLevel: 5,
      subject: "science",
    });
    expect(result.success).toBe(true);
    // Primary must not carry a secondary sub-level.
    const withSubLevel = examParamsSchema.safeParse({
      ...validParams,
      level: "primary",
      classLevel: 5,
      subject: "science",
    });
    expect(withSubLevel.success).toBe(false);
  });

  it("enforces duration and question bounds", () => {
    expect(examParamsSchema.safeParse({ ...validParams, durationMinutes: 4 }).success).toBe(false);
    expect(examParamsSchema.safeParse({ ...validParams, durationMinutes: 241 }).success).toBe(false);
    expect(exampleBad(examParamsSchema.safeParse({ ...validParams, questionCount: 0 }))).toBe(false);
  });

  it("requires at least one question type", () => {
    expect(
      examParamsSchema.safeParse({ ...validParams, questionTypes: [] }).success,
    ).toBe(false);
  });

  it("generateExamSchema defaults documentIds to []", () => {
    const parsed = generateExamSchema.parse({ params: validParams });
    expect(parsed.documentIds).toEqual([]);
  });
});

describe("exam output schema", () => {
  const output = (title: string) => ({
    title,
    questions: [{ type: "essay", prompt: "Explain.", points: 1 }],
  });

  it("rejects titles that are empty after trimming", () => {
    expect(examOutputSchema.safeParse(output("   ")).success).toBe(false);
  });

  it("trims titles and preserves the stored 160-character ceiling", () => {
    const parsed = examOutputSchema.parse(output(`  ${"x".repeat(170)}  `));
    expect(parsed.title).toBe("x".repeat(160));
  });
});

describe("unassign exam schema", () => {
  it("rejects selections larger than one bounded transaction", () => {
    const studentIds = Array.from(
      { length: MAX_UNASSIGN_STUDENTS + 1 },
      (_, index) => `student-${index}`,
    );

    expect(unassignExamSchema.safeParse({ examId: "exam-1", studentIds }).success).toBe(false);
  });
});

function exampleBad(result: { success: boolean }): boolean {
  return result.success;
}

describe("auth schemas", () => {
  it("setup enforces strong passwords", () => {
    const base = {
      setupKey: "key",
      displayName: "Herbert",
      email: "h@example.com",
    };
    expect(setupSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "alllowercase1" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "nouppercase123" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "ValidPass123" }).success).toBe(true);
  });

  it("login requires an email + password", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
});

describe("user status schema", () => {
  it("requires an expiry for suspended users", () => {
    const suspended = { userId: "u1", status: "suspended" };
    expect(setUserStatusSchema.safeParse(suspended).success).toBe(false);
    expect(
      setUserStatusSchema.safeParse({
        ...suspended,
        suspendedUntil: "2026-09-08T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("keeps the suspension expiry optional for other statuses", () => {
    expect(setUserStatusSchema.safeParse({ userId: "u1", status: "active" }).success).toBe(true);
    expect(setUserStatusSchema.safeParse({ userId: "u1", status: "banned" }).success).toBe(true);
  });
});

describe("user-agent parsing", () => {
  it("detects common browsers", () => {
    expect(parseUserAgent("Mozilla/5.0 Chrome/120.0 Safari/537.36").browser).toBe("Chrome");
    expect(parseUserAgent("Mozilla/5.0 Firefox/121.0").browser).toBe("Firefox");
    expect(parseUserAgent("Mozilla/5.0 Safari/605.1.15 Version/17.0").browser).toBe("Safari");
    expect(parseUserAgent("Mozilla/5.0 Edg/120.0").browser).toBe("Edge");
  });

  it("classifies devices", () => {
    expect(parseUserAgent("iPhone; CPU iPhone OS 17_0").device).toBe("mobile");
    expect(parseUserAgent("iPad; CPU OS 17_0").device).toBe("tablet");
    expect(parseUserAgent("Windows NT 10.0; Win64; x64").device).toBe("desktop");
  });

  it("handles missing agents", () => {
    expect(parseUserAgent(null)).toEqual({ browser: "Unknown", device: "unknown" });
  });
});

describe("domain constants", () => {
  it("curriculum covers the required subjects per level", () => {
    expect(COUNTRY_CURRICULA.UG.primary).toHaveLength(4);
    // Uganda O level (S1–S4): 13 subjects; A level (S5–S6): 11 subjects.
    expect(O_LEVEL_SUBJECTS).toHaveLength(13);
    expect(A_LEVEL_SUBJECTS).toHaveLength(11);
    for (const s of [...O_LEVEL_SUBJECTS, ...A_LEVEL_SUBJECTS]) {
      expect(SUBJECT_LABELS[s]).toBeTruthy();
    }
    // O/A specific subjects.
    expect(O_LEVEL_SUBJECTS).toContain("commerce");
    expect(O_LEVEL_SUBJECTS).toContain("literature_in_english");
    expect(A_LEVEL_SUBJECTS).toContain("economics_entrepreneurship");
    expect(A_LEVEL_SUBJECTS).not.toContain("commerce");
    expect(A_LEVEL_SUBJECTS).not.toContain("computer_studies");
  });

  it("proctoring policy gives exactly two warnings", () => {
    expect(PROCTORING.maxWarnings).toBe(2);
    expect(PROCTORING.snapshotIntervalMs).toBeGreaterThanOrEqual(15_000);
  });

  it("difficulties and question types are stable enums", () => {
    expect(DIFFICULTIES).toHaveLength(4);
    expect(QUESTION_TYPES).toContain("multiple_choice");
    expect(QUESTION_TYPES).toContain("essay");
  });
});
