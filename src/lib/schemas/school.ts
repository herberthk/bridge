import { z } from "zod";

import {
  PRIMARY_CLASSES,
  O_LEVEL_CLASSES,
  A_LEVEL_CLASSES,
  SCHOOL_LEVELS,
  SECONDARY_SUB_LEVELS,
} from "@/lib/constants";

/**
 * School, class, invite and wallet-top-up schemas.
 *
 * `.describe()` text doubles as AI tool documentation where schemas are reused
 * there; for these staff-facing forms it mainly keeps intent next to shape.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** A member (signed-up user) creating their own school and becoming its admin. */
export const createSelfSchoolSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter the school's name")
    .max(120)
    .describe("Official registered name of the school."),
  /**
   * Primary OR secondary — a single mutually-exclusive field by design: the
   * choice drives the standard class set (P1–P7 vs S1–S6) and the curriculum.
   */
  level: z
    .enum(SCHOOL_LEVELS)
    .describe(
      "School tier: 'primary' (Primary 1–7, PLE curriculum) or 'secondary' (Ordinary Level S1–S4 / Advanced Level S5–S6). A school is one or the other, never both.",
    ),
  motto: optionalText(140).describe("School motto or tagline (optional)."),
  address: optionalText(200).describe("Physical address of the school (optional)."),
  phone: optionalText(20).describe("Contact phone number (optional)."),
  email: optionalText(120).describe("Official contact email (optional)."),
  registrationNumber: optionalText(60).describe(
    "Official registration / EMIS number used for blue-tick verification (optional here, required to request verification).",
  ),
  description: optionalText(500).describe("Short public description of the school (optional)."),
  /** Which standard classes to create with the school (defaults to the full set). */
  classLevels: z
    .array(z.coerce.number().int())
    .max(12)
    .optional()
    .describe("Class years to create at onboarding, e.g. [1,2,3] for Primary 1–3."),
});
export type CreateSelfSchoolInput = z.infer<typeof createSelfSchoolSchema>;

/** Staff (admin or teacher) creating missing classes for their school. */
export const createClassesSchema = z.object({
  classLevels: z
    .array(z.coerce.number().int())
    .min(1, "Select at least one class")
    .max(12)
    .describe("Class years to create, e.g. [1, 2] → Primary 1 & 2 (or Senior 1 & 2)."),
});
export type CreateClassesInput = z.infer<typeof createClassesSchema>;

/** Super Admin verifying (or revoking) a school's blue tick. */
export const setSchoolVerificationSchema = z.object({
  schoolId: z.string().min(1).describe("School receiving the verification decision."),
  status: z
    .enum(["verified", "unverified"])
    .describe("'verified' grants the blue tick; 'unverified' revokes it."),
});
export type SetSchoolVerificationInput = z.infer<typeof setSchoolVerificationSchema>;

/** School admin updating their school's profile. */
export const updateSchoolProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter the school's name").max(120),
  motto: optionalText(140),
  address: optionalText(200),
  phone: optionalText(20),
  email: optionalText(120),
  registrationNumber: optionalText(60),
  description: optionalText(500),
});
export type UpdateSchoolProfileInput = z.infer<typeof updateSchoolProfileSchema>;

/** Admin inviting a teacher to their school. */
export const createTeacherInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("The teacher's email — the invite link is sent here."),
  /** Classes assigned to the teacher immediately on acceptance. */
  classIds: z
    .array(z.string().trim().min(1))
    .max(30)
    .default([])
    .describe("Class ids the teacher will manage once they accept."),
});
export type CreateTeacherInviteInput = z.infer<typeof createTeacherInviteSchema>;

/** Public accept-invite form (no session yet — the invite token is the authority). */
export const acceptInviteSchema = z.object({
  token: z.string().min(10, "Invalid invite link").max(200),
  displayName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80)
    .describe("The teacher's full name, shown to colleagues and students."),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(100)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number")
    .describe("Password the teacher chooses for their new account."),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** Admin assigning (re-assigning) the classes a teacher manages. */
export const assignTeacherClassesSchema = z.object({
  teacherId: z.string().min(1).describe("Teacher being (re)assigned."),
  classIds: z
    .array(z.string().min(1))
    .max(30)
    .describe("Full set of class ids the teacher should manage (replaces the old set)."),
});
export type AssignTeacherClassesInput = z.infer<typeof assignTeacherClassesSchema>;

/**
 * Self-serve wallet credit. Tokens arrive as a form string and are coerced;
 * the hard ceiling guards against typos (largest preset pack is 10M).
 */
export const createTopupSchema = z.object({
  tokens: z.coerce
    .number()
    .int("Tokens must be a whole number")
    .min(1_000, "Minimum top-up is 1,000 tokens.")
    .max(100_000_000, "That amount looks like a typo — maximum is 100,000,000.")
    .describe("Number of AI tokens to purchase."),
  packId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe("Preset pack id when the purchase came from a pack card."),
});
export type CreateTopupInput = z.infer<typeof createTopupSchema>;

/** Admin/teacher authorizing a student retake without a student request. */
export const authorizeRetakeSchema = z.object({
  attemptId: z.string().min(1).describe("The graded/flagged attempt being retaken."),
});
export type AuthorizeRetakeInput = z.infer<typeof authorizeRetakeSchema>;

/** Which standard class years are valid for a level (shared by UI + schema). */
export function validClassLevelsFor(
  level: (typeof SCHOOL_LEVELS)[number],
  secondarySubLevel?: (typeof SECONDARY_SUB_LEVELS)[number] | null,
): readonly number[] {
  if (level === "primary") return PRIMARY_CLASSES;
  // No explicit sub-level → the full secondary range (S1–S6).
  if (!secondarySubLevel) return [...O_LEVEL_CLASSES, ...A_LEVEL_CLASSES];
  return secondarySubLevel === "a_level" ? A_LEVEL_CLASSES : O_LEVEL_CLASSES;
}
