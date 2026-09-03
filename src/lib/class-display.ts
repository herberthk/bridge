import type { ClassDoc } from "@/types/firestore";

/** Two-letter monogram for a class avatar (e.g. "Primary 1" → "P1"). */
export function classMonogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CL";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "CL").toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase() || "CL";
}

/** Short curriculum badge label for a class (Primary / O level / A level). */
export function classLevelLabel(cls: Pick<ClassDoc, "level" | "secondarySubLevel">): string {
  if (cls.level === "primary") return "Primary";
  return cls.secondarySubLevel === "a_level" ? "A level" : "O level";
}

/** First value of a Next.js search param (which may be repeated). */
export function firstSearchParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Parse the voice-builder handoff (level + class year, no classId) into a
 * validated class scope. One class exists per year within a school, so a
 * parsed scope resolves unambiguously; anything else is null.
 */
export function parseVoiceClassScope(
  params: Record<string, string | string[] | undefined>,
): { level: "primary" | "secondary"; classLevel: number } | null {
  const level = firstSearchParam(params.level);
  const rawClassLevel = firstSearchParam(params.classLevel);
  // Number("") is 0 — treat a missing year as missing, not as year zero.
  if (rawClassLevel.trim() === "") return null;
  const classLevel = Number(rawClassLevel);
  if ((level !== "primary" && level !== "secondary") || !Number.isInteger(classLevel)) {
    return null;
  }
  return { level, classLevel };
}
