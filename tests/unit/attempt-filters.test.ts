import { describe, expect, it } from "vitest";

import {
  countByTab,
  filterAndSortAttempts,
  tabOf,
  type FilterableAttempt,
} from "@/lib/exam/attempt-filters";

function item(
  overrides: Partial<FilterableAttempt["attempt"]> & { subject?: string; title?: string } = {},
): FilterableAttempt {
  const { subject = "math", title = "Exam", ...attempt } = overrides;
  return {
    attempt: { status: "graded", score: { percentage: 70 }, createdAt: "2026-01-01T00:00:00Z", ...attempt },
    exam: { title, subject },
  };
}

describe("tabOf", () => {
  it("groups every attempt status", () => {
    expect(tabOf("pending")).toBe("todo");
    expect(tabOf("in_progress")).toBe("todo");
    expect(tabOf("submitted")).toBe("grading");
    expect(tabOf("graded")).toBe("graded");
    expect(tabOf("flagged")).toBe("review");
  });
});

describe("countByTab", () => {
  it("counts all groups in one pass", () => {
    const items = [
      item({ status: "pending" }),
      item({ status: "submitted" }),
      item({ status: "graded" }),
      item({ status: "flagged" }),
    ];
    expect(countByTab(items)).toEqual({ all: 4, todo: 1, grading: 1, graded: 1, review: 1 });
  });
});

describe("filterAndSortAttempts", () => {
  const items = [
    item({ status: "pending", score: null, title: "Algebra Basics", createdAt: "2026-03-01T00:00:00Z" }),
    item({ status: "graded", score: { percentage: 90 }, title: "Algebra Final", createdAt: "2026-02-01T00:00:00Z" }),
    item({ status: "submitted", score: null, title: "Biology Quiz", subject: "bio", createdAt: "2026-04-01T00:00:00Z" }),
  ];

  it("filters by tab", () => {
    const out = filterAndSortAttempts(items, { tab: "todo", subject: "all", sort: "newest", query: "" });
    expect(out.map((i) => i.exam!.title)).toEqual(["Algebra Basics"]);
  });

  it("filters by subject", () => {
    const out = filterAndSortAttempts(items, { tab: "all", subject: "bio", sort: "newest", query: "" });
    expect(out.map((i) => i.exam!.title)).toEqual(["Biology Quiz"]);
  });

  it("searches title case-insensitively", () => {
    const out = filterAndSortAttempts(items, { tab: "all", subject: "all", sort: "newest", query: "algebra" });
    expect(out.map((i) => i.exam!.title).sort()).toEqual(["Algebra Basics", "Algebra Final"]);
  });

  it("sorts oldest first", () => {
    const out = filterAndSortAttempts(items, { tab: "all", subject: "all", sort: "oldest", query: "" });
    expect(out[0]!.exam!.title).toBe("Algebra Final");
  });

  it("sorts by score with unscored items sunk to the bottom", () => {
    const highest = filterAndSortAttempts(items, { tab: "all", subject: "all", sort: "highest", query: "" });
    expect(highest[0]!.exam!.title).toBe("Algebra Final");
    const lowest = filterAndSortAttempts(items, { tab: "all", subject: "all", sort: "lowest", query: "" });
    expect(lowest[lowest.length - 1]!.attempt.score).toBeNull();
  });

  it("does not mutate the input array", () => {
    const snapshot = [...items];
    filterAndSortAttempts(items, { tab: "all", subject: "all", sort: "lowest", query: "" });
    expect(items).toEqual(snapshot);
  });
});
