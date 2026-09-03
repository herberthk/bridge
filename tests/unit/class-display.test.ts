import { describe, expect, it } from "vitest";

import {
  classLevelLabel,
  classMonogram,
  firstSearchParam,
  parseVoiceClassScope,
} from "@/lib/class-display";

describe("classMonogram", () => {
  it("takes first letters of first and last words", () => {
    expect(classMonogram("Primary 1")).toBe("P1");
    expect(classMonogram("Senior 4")).toBe("S4");
  });

  it("handles single-word names", () => {
    expect(classMonogram("Reception")).toBe("RE");
    expect(classMonogram("P")).toBe("P");
  });

  it("trims and collapses whitespace", () => {
    expect(classMonogram("  Senior   4  ")).toBe("S4");
  });

  it("never returns an empty avatar", () => {
    expect(classMonogram("")).toBe("CL");
    expect(classMonogram("   ")).toBe("CL");
  });
});

describe("classLevelLabel", () => {
  it("labels primary classes", () => {
    expect(classLevelLabel({ level: "primary", secondarySubLevel: null })).toBe("Primary");
  });

  it("distinguishes O level from A level", () => {
    expect(classLevelLabel({ level: "secondary", secondarySubLevel: "o_level" })).toBe("O level");
    expect(classLevelLabel({ level: "secondary", secondarySubLevel: "a_level" })).toBe("A level");
  });

  it("defaults a missing sub-level to O level", () => {
    expect(classLevelLabel({ level: "secondary", secondarySubLevel: null })).toBe("O level");
  });
});

describe("firstSearchParam", () => {
  it("returns single values as-is", () => {
    expect(firstSearchParam("abc")).toBe("abc");
  });

  it("takes the first of repeated params", () => {
    expect(firstSearchParam(["a", "b"])).toBe("a");
  });

  it("normalises missing params to empty string", () => {
    expect(firstSearchParam(undefined)).toBe("");
    expect(firstSearchParam([])).toBe("");
  });
});

describe("parseVoiceClassScope", () => {
  it("parses a complete voice handoff", () => {
    expect(parseVoiceClassScope({ level: "secondary", classLevel: "4" })).toEqual({
      level: "secondary",
      classLevel: 4,
    });
  });

  it("rejects unknown levels", () => {
    expect(parseVoiceClassScope({ level: "tertiary", classLevel: "2" })).toBeNull();
  });

  it("rejects missing or non-integer class years", () => {
    expect(parseVoiceClassScope({ level: "primary" })).toBeNull();
    expect(parseVoiceClassScope({ level: "primary", classLevel: "" })).toBeNull();
    expect(parseVoiceClassScope({ level: "primary", classLevel: "2.5" })).toBeNull();
    expect(parseVoiceClassScope({ level: "primary", classLevel: "P2" })).toBeNull();
  });

  it("accepts the first of repeated params", () => {
    expect(parseVoiceClassScope({ level: ["secondary", "primary"], classLevel: ["4", "2"] })).toEqual({
      level: "secondary",
      classLevel: 4,
    });
  });
});
