import { describe, expect, it } from "vitest";

import { normalizeDirectorySchool, normalizeDirectoryStatus } from "@/lib/directory-filters";

describe("directory filter normalization", () => {
  const schools = [{ id: "school-1" }, { id: "school-2" }];

  it("keeps available school and status filters", () => {
    expect(normalizeDirectorySchool("school-2", schools)).toBe("school-2");
    expect(normalizeDirectoryStatus("active")).toBe("active");
  });

  it("resets unavailable filters", () => {
    expect(normalizeDirectorySchool("missing", schools)).toBeNull();
    expect(normalizeDirectoryStatus("deleted")).toBeNull();
    expect(normalizeDirectoryStatus("all")).toBeNull();
  });
});
