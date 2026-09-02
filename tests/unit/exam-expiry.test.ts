import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import { formatExpiry, isExamExpired } from "@/lib/exam/expiry";

describe("isExamExpired", () => {
  it("is not expired when there is no deadline", () => {
    expect(isExamExpired({})).toBe(false);
    expect(isExamExpired({ expiresAt: null })).toBe(false);
  });

  it("is expired once the deadline has passed", () => {
    const exam = { expiresAt: Timestamp.fromMillis(Date.now() - 1000) };
    expect(isExamExpired(exam)).toBe(true);
  });

  it("is not expired before the deadline", () => {
    const exam = { expiresAt: Timestamp.fromMillis(Date.now() + 60_000) };
    expect(isExamExpired(exam)).toBe(false);
  });

  it("respects an explicit now for deterministic checks", () => {
    const exam = { expiresAt: Timestamp.fromMillis(2_000) };
    expect(isExamExpired(exam, 1_999)).toBe(false);
    expect(isExamExpired(exam, 2_000)).toBe(true);
  });
});

describe("formatExpiry", () => {
  it("returns null when there is no deadline", () => {
    expect(formatExpiry({})).toBeNull();
    expect(formatExpiry({ expiresAt: null })).toBeNull();
  });

  it("formats the deadline for display", () => {
    const exam = { expiresAt: Timestamp.fromMillis(Date.UTC(2026, 8, 12, 9, 30)) };
    expect(formatExpiry(exam)).toContain("2026");
    expect(formatExpiry(exam)).toContain("12");
    expect(formatExpiry(exam)).toContain("30");
  });
});
