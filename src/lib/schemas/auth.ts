import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("User's registered email address for account authentication."),
  password: z
    .string()
    .min(1, "Password is required")
    .describe("User's secret account password."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const setupSchema = z.object({
  setupKey: z
    .string()
    .min(1, "Setup key is required")
    .describe("One-time security authorization key required to bootstrap initial system setup."),
  displayName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80)
    .describe("Full legal or professional name of the initial super administrator."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("Primary administrative email address for the initial super administrator account."),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(100)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number")
    .describe(
      "Strong password meeting security complexity standards (at least 10 characters, including uppercase, lowercase, and numeric digits).",
    ),
});
export type SetupInput = z.infer<typeof setupSchema>;

/** Public sign-up — "join the platform as a normal user". */
export const signupSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter your full name")
    .max(80)
    .describe("Full name shown across dashboards and exams."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .describe("Email address used for sign-in."),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(100)
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[0-9]/, "Include a number")
    .describe("Password meeting security complexity standards."),
});
export type SignupInput = z.infer<typeof signupSchema>;

