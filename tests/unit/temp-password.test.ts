import { describe, expect, it } from "vitest";

import { generateTempPassword } from "@/lib/temp-password";

describe("generateTempPassword", () => {
  it("defaults to 12 characters meeting the account policy", () => {
    for (let i = 0; i < 25; i += 1) {
      const password = generateTempPassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it("floors short requests at the 10-character policy minimum", () => {
    expect(generateTempPassword(4)).toHaveLength(10);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite length %s",
    (length) => {
      expect(() => generateTempPassword(length)).toThrow(RangeError);
    },
  );

  it("excludes ambiguous glyphs that mistype off a screen", () => {
    for (let i = 0; i < 25; i += 1) {
      expect(generateTempPassword(32)).not.toMatch(/[0O1lI]/);
    }
  });

  it("produces distinct passwords", () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
    expect(seen.size).toBeGreaterThan(1);
  });
});
