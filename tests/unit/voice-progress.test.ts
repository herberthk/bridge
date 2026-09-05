import { describe, expect, it } from "vitest";

import { isSubsidiaryStepComplete } from "@/components/features/admin/voice-builder";

describe("isSubsidiaryStepComplete", () => {
  it("stays incomplete when no subject is selected (empty spec is 0/5)", () => {
    expect(isSubsidiaryStepComplete(undefined, undefined)).toBe(false);
    expect(isSubsidiaryStepComplete(undefined, "african_history")).toBe(false);
  });

  it("completes immediately for non-history subjects", () => {
    expect(isSubsidiaryStepComplete("mathematics", undefined)).toBe(true);
    expect(isSubsidiaryStepComplete("biology", undefined)).toBe(true);
  });

  it("requires a branch for history", () => {
    expect(isSubsidiaryStepComplete("history", undefined)).toBe(false);
    expect(isSubsidiaryStepComplete("history", "")).toBe(false);
    expect(isSubsidiaryStepComplete("history", "african_history")).toBe(true);
    expect(isSubsidiaryStepComplete("history", "european_history")).toBe(true);
  });
});
