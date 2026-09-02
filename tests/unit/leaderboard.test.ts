import { describe, expect, it } from "vitest";

import {
  buildClassStats,
  buildLeaderboard,
  type LeaderboardAttempt,
  type LeaderboardStudent,
} from "@/lib/leaderboard";

const students: LeaderboardStudent[] = [
  { id: "s1", displayName: "Aisha" },
  { id: "s2", displayName: "Brian" },
  { id: "s3", displayName: "Cynthia" },
];

function attempt(
  studentId: string,
  percentage: number,
  earned = percentage,
  possible = 100,
): LeaderboardAttempt {
  return {
    studentId,
    status: "graded",
    score: { earned, possible, percentage },
  };
}

describe("buildLeaderboard", () => {
  it("ranks by average percentage descending", () => {
    const entries = buildLeaderboard(students, [
      attempt("s1", 80),
      attempt("s2", 90),
      attempt("s3", 70),
    ]);
    expect(entries.map((e) => e.studentId)).toEqual(["s2", "s1", "s3"]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties by best single attempt", () => {
    const entries = buildLeaderboard(students.slice(0, 2), [
      attempt("s1", 80),
      attempt("s1", 80),
      attempt("s2", 90),
      attempt("s2", 70),
    ]);
    // Both average 80 — Brian has the best single attempt (90).
    expect(entries[0]!.studentId).toBe("s2");
    expect(entries[1]!.studentId).toBe("s1");
    expect(entries[0]!.averagePercentage).toBe(80);
    expect(entries[1]!.averagePercentage).toBe(80);
  });

  it("lists students without graded attempts unranked at the bottom", () => {
    const entries = buildLeaderboard(students, [attempt("s2", 90)]);
    const unranked = entries.filter((e) => e.rank === null);
    expect(unranked.map((e) => e.studentId).sort()).toEqual(["s1", "s3"]);
    expect(unranked.every((e) => e.averagePercentage === null)).toBe(true);
    expect(entries[0]!.rank).toBe(1);
    expect(entries[0]!.studentId).toBe("s2");
  });

  it("ignores non-graded attempts", () => {
    const entries = buildLeaderboard(students, [
      { studentId: "s1", status: "pending", score: null },
      { studentId: "s1", status: "in_progress", score: { earned: 1, possible: 1, percentage: 100 } },
      attempt("s1", 50),
    ]);
    expect(entries[0]!.attemptsTaken).toBe(1);
    expect(entries[0]!.averagePercentage).toBe(50);
  });

  it("computes trend from the last attempt vs the previous average", () => {
    const entries = buildLeaderboard(students.slice(0, 1), [
      attempt("s1", 60),
      attempt("s1", 80),
    ]);
    // Last = 80, previous mean = 60 → +20.
    expect(entries[0]!.trend).toBe(20);
  });

  it("totals marks across attempts", () => {
    const entries = buildLeaderboard(students.slice(0, 1), [
      attempt("s1", 80, 40, 50),
      attempt("s1", 90, 18, 20),
    ]);
    expect(entries[0]!.totalMarksEarned).toBe(58);
    expect(entries[0]!.totalMarksPossible).toBe(70);
  });

  it("handles an empty class", () => {
    expect(buildLeaderboard([], [])).toEqual([]);
  });
});

describe("buildClassStats", () => {
  it("aggregates class-level numbers", () => {
    const stats = buildClassStats(students, [
      attempt("s1", 80),
      attempt("s2", 60),
      { studentId: "s3", status: "pending", score: null },
    ]);
    expect(stats.students).toBe(3);
    expect(stats.gradedAttempts).toBe(2);
    expect(stats.averagePercentage).toBe(70);
    expect(stats.participationRate).toBe(67);
    expect(stats.topPercentage).toBe(80);
  });

  it("handles a class with no attempts", () => {
    const stats = buildClassStats(students, []);
    expect(stats.averagePercentage).toBeNull();
    expect(stats.participationRate).toBe(0);
    expect(stats.topPercentage).toBeNull();
  });
});
