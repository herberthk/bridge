import { describe, expect, it } from "vitest";

import { parseDate, timestampToDate } from "@/lib/serialize";

describe("timestamp parsing", () => {
  it("accepts numeric epoch zero", () => {
    expect(timestampToDate(0)?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(parseDate(0)?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("still treats only nullish inputs as missing", () => {
    expect(timestampToDate(null)).toBeNull();
    expect(timestampToDate(undefined)).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});
