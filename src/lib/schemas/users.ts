import { z } from "zod";

import {
  PRIMARY_CLASSES,
  SECONDARY_CLASSES,
} from "@/lib/constants";

const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(100)
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const createStudentSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the student's name").max(80),
  email: z.string().trim().email("Enter a valid email address"),
  password: passwordSchema,
  level: z.enum(["primary", "secondary"]),
  classLevel: z.number().int(),
  schoolId: z.string().trim().min(1, "School is required").optional(),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const createSchoolSchema = z.object({
  schoolName: z.string().trim().min(2, "Enter the school's name").max(120),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(80),
  ownerEmail: z.string().trim().email("Enter a valid email address"),
  ownerPassword: passwordSchema,
});
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;

export const createStandaloneAdminSchema = z.object({
  displayName: z.string().trim().min(2, "Enter the admin's name").max(80),
  email: z.string().trim().email("Enter a valid email address"),
  password: passwordSchema,
});
export type CreateStandaloneAdminInput = z.infer<typeof createStandaloneAdminSchema>;

export const setUserStatusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "suspended", "banned"]),
  reason: z.string().trim().max(300).optional(),
  /** ISO date; only for suspensions. */
  suspendedUntil: z.string().datetime().optional(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;

/** Client-side helpers for class level options. */
export const classLevelOptions = (level: "primary" | "secondary") =>
  (level === "primary" ? PRIMARY_CLASSES : SECONDARY_CLASSES).map((n) => ({
    value: n,
    label: level === "primary" ? `Primary ${n}` : `Secondary ${n}`,
  }));
