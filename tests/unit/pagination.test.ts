import { describe, expect, it } from "vitest";

import {
  clampPage,
  dedupeIds,
  namePrefixRange,
  offsetForPage,
  pageWindow,
  totalPages,
} from "@/lib/pagination";

describe("offsetForPage", () => {
  it("maps 1-based pages to offsets", () => {
    expect(offsetForPage(1, 20)).toBe(0);
    expect(offsetForPage(2, 20)).toBe(20);
    expect(offsetForPage(5, 25)).toBe(100);
  });

  it("clamps non-positive and fractional pages", () => {
    expect(offsetForPage(0)).toBe(0);
    expect(offsetForPage(-3)).toBe(0);
    expect(offsetForPage(2.9, 20)).toBe(20);
  });
});

describe("totalPages / clampPage", () => {
  it("computes page totals", () => {
    expect(totalPages(0, 20)).toBe(1);
    expect(totalPages(1, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(40, 20)).toBe(2);
  });

  it("clamps pages into the valid range", () => {
    expect(clampPage(0, 45, 20)).toBe(1);
    expect(clampPage(3, 45, 20)).toBe(3);
    expect(clampPage(99, 45, 20)).toBe(3);
  });

  it("floors fractional pages before clamping", () => {
    expect(clampPage(2.9, 45, 20)).toBe(2);
    expect(clampPage(0.9, 45, 20)).toBe(1);
  });

  it("treats non-finite pages as page one", () => {
    expect(clampPage(Number.NaN, 45, 20)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 45, 20)).toBe(1);
    expect(clampPage(Number.NEGATIVE_INFINITY, 45, 20)).toBe(1);
  });
});

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(2, 45, 20)).toEqual([1, 2, 3]);
  });

  it("adds ellipses in the middle of a long range", () => {
    expect(pageWindow(7, 200, 20)).toEqual([1, "…", 6, 7, 8, "…", 10]);
    expect(pageWindow(1, 200, 20)).toEqual([1, 2, 3, 4, "…", 10]);
    expect(pageWindow(9, 200, 20)).toEqual([1, "…", 7, 8, 9, 10]);
  });
});

describe("namePrefixRange", () => {
  it("builds a lexicographic range for prefix search", () => {
    expect(namePrefixRange("Ama")).toEqual({ start: "ama", end: "ama\uf8ff" });
  });

  it("returns null for empty queries", () => {
    expect(namePrefixRange("")).toBeNull();
    expect(namePrefixRange("   ")).toBeNull();
    expect(namePrefixRange(null)).toBeNull();
  });
});

describe("dedupeIds", () => {
  it("drops empties and duplicates, preserving order", () => {
    expect(dedupeIds(["a", "b", "a", "", null, undefined, "c"])).toEqual(["a", "b", "c"]);
  });
});
