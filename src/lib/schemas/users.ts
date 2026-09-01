import { z } from "zod";

import {
  PRIMARY_CLASSES,
  O_LEVEL_CLASSES,
  A_LEVEL_CLASSES,
  SECONDARY_SUB_LEVELS,
} from "@/lib/constants";

const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(100)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number")
  .describe(
    "User password meeting security complexity standards (at least 10 characters with uppercase, lowercase, and numeric digits).",
  );

export const createStudentSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, "Enter the student's name")
      .max(80)
      .describe("Full legal or school register name of the student."),
    email: z
      .string()
      .trim()
      .email("Enter a valid email address")
      .describe("Unique email address for the student account login."),
    password: passwordSchema.describe("Initial password assigned to the student account."),
    level: z
      .enum(["primary", "secondary"])
      .describe(
        "School education tier: 'primary' (Primary 1 to Primary 7, PLE curriculum) or 'secondary' (Ordinary / Advanced Level).",
      ),
    /** O level vs A level; required for secondary students. */
    secondarySubLevel: z
      .enum(SECONDARY_SUB_LEVELS)
      .nullable()
      .default(null)
      .describe(
        "Secondary school curriculum sub-level: 'o_level' (Ordinary Level / UCE: Senior 1 to Senior 4, ages ~13–16) or 'a_level' (Advanced Level / UACE: Senior 5 to Senior 6, ages ~17–19). Must be null for primary students.",
      ),
    classLevel: z
      .number()
      .int()
      .describe(
        "Numerical class/grade year: 1 to 7 for primary (representing P1–P7), 1 to 4 for O-level secondary (representing S1–S4), or 5 to 6 for A-level secondary (representing S5–S6).",
      ),
    schoolId: z
      .string()
      .trim()
      .min(1, "School is required")
      .optional()
      .describe("Unique identifier of the school or academic institution the student belongs to."),
  })
  .refine(
    (s) =>
      s.level === "primary"
        ? (PRIMARY_CLASSES as readonly number[]).includes(s.classLevel) &&
          s.secondarySubLevel === null
        : Boolean(s.secondarySubLevel) &&
          ((s.secondarySubLevel === "o_level"
            ? O_LEVEL_CLASSES
            : A_LEVEL_CLASSES
          ) as readonly number[]).includes(s.classLevel),
    {
      message:
        "Class must match the level (P1–P7; O level S1–S4; A level S5–S6)",
      path: ["classLevel"],
    },
  );
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const createSchoolSchema = z.object({
  schoolName: z
    .string()
    .trim()
    .min(2, "Enter the school's name")
    .max(120)
    .describe("Official registered name of the school or educational institution."),
  ownerName: z
    .string()
    .trim()
    .min(2, "Enter the owner's name")
    .max(80)
    .describe("Full name of the principal, headteacher, or school owner administrator."),
  ownerEmail: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("Primary contact and login email address for the school owner account."),
  ownerPassword: passwordSchema.describe(
    "Secure initial password for the school owner administrator account.",
  ),
});
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

export const createStandaloneAdminSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter the admin's name")
    .max(80)
    .describe("Full name of the system or standalone administrator."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("Administrative email address used for sign-in and security alerts."),
  password: passwordSchema.describe(
    "Secure password for the standalone administrator account.",
  ),
});
export type CreateStandaloneAdminInput = z.infer<typeof createStandaloneAdminSchema>;

export const setUserStatusSchema = z
  .object({
    userId: z
      .string()
      .min(1)
      .describe("Unique identifier of the user account whose status is being modified."),
    status: z
      .enum(["active", "suspended", "banned"])
      .describe(
        "Account operational status: 'active' (normal full access), 'suspended' (temporarily blocked until a date), or 'banned' (permanently deactivated).",
      ),
    reason: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe("Administrative explanation or justification for the status change."),
    /** ISO date; only for suspensions. */
    suspendedUntil: z
      .string()
      .datetime()
      .optional()
      .describe(
        "ISO-8601 UTC timestamp indicating when a temporary account suspension ends (required when status is 'suspended').",
      ),
  })
  .refine((input) => input.status !== "suspended" || Boolean(input.suspendedUntil), {
    message: "Choose when the suspension ends",
    path: ["suspendedUntil"],
  });
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/**
 * Manual wallet credit. Tokens arrive as a form string and are coerced; the
 * hard ceiling guards against typos (the largest preset pack is 10M).
 */
export const topupWalletSchema = z.object({
  walletId: z
    .string()
    .min(1)
    .describe("Unique identifier of the billing wallet receiving the token credit."),
  tokens: z.coerce
    .number()
    .int("Tokens must be a whole number")
    .min(1, "Enter a valid token amount.")
    .max(100_000_000, "That amount looks like a typo — maximum is 100,000,000.")
    .describe(
      "Number of AI generation tokens to credit to the wallet (e.g. 100,000 up to 100,000,000).",
    ),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("Optional note or reference explaining the reason for the manual wallet credit."),
});
export type TopupWalletInput = z.infer<typeof topupWalletSchema>;

/** Client-side helpers for class level options. */
export const classLevelOptions = (
  level: "primary" | "secondary",
  secondarySubLevel?: "o_level" | "a_level" | null,
) => {
  if (level === "primary") {
    return PRIMARY_CLASSES.map((n) => ({ value: n, label: `Primary ${n}` }));
  }
  const classes =
    secondarySubLevel === "a_level" ? A_LEVEL_CLASSES : O_LEVEL_CLASSES;
  return classes.map((n) => ({
    value: n,
    label: secondarySubLevel === "a_level" ? `Senior ${n}` : `Senior ${n}`,
  }));
};
