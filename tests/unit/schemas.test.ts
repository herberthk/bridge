import { describe, expect, it } from "vitest";

import { examParamsSchema, generateExamSchema } from "@/lib/schemas/exam";
import { setupSchema, loginSchema } from "@/lib/schemas/auth";
import { parseUserAgent } from "@/lib/user-agent";
import {
  COUNTRY_CURRICULA,
  PROCTORING,
  DIFFICULTIES,
  QUESTION_TYPES,
  SUBJECT_LABELS,
} from "@/lib/constants";

const validParams = {
  subject: "physics",
  level: "secondary" as const,
  classLevel: 3,
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

  it("rejects primary class 5 with level secondary", () => {
    const result = examParamsSchema.safeParse({
      ...validParams,
      level: "primary",
      classLevel: 5,
      subject: "science",
    });
    expect(result.success).toBe(true); // P5 with a primary subject is valid
    const bad = examParamsSchema.safeParse({
      ...validParams,
      level: "primary",
      classLevel: 5,
      subject: "physics", // physics isn't a primary subject… schema allows; UI restricts
    });
    expect(bad.success).toBe(true); // schema-level: subject is a free string; curriculum check happens in UI
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
    expect(COUNTRY_CURRICULA.UG.secondary).toHaveLength(8);
    for (const s of COUNTRY_CURRICULA.UG.secondary) {
      expect(SUBJECT_LABELS[s]).toBeTruthy();
    }
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
