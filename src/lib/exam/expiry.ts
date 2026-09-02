import type { FirestoreTimestamp } from "@/types/firestore";

/**
 * Pure exam-expiry helpers — no I/O so they are trivially unit-testable and
 * reusable on both sides of the client/server boundary.
 */

type ExpirySource = {
  expiresAt?: FirestoreTimestamp | null;
};

export function isExamExpired(exam: ExpirySource, nowMs: number = Date.now()): boolean {
  const expiresAt = exam.expiresAt;
  if (!expiresAt || typeof expiresAt.toMillis !== "function") return false;
  return expiresAt.toMillis() <= nowMs;
}

/** Human label for a deadline, e.g. "Closes 12 Sep 2026, 14:30". */
export function formatExpiry(exam: ExpirySource): string | null {
  const expiresAt = exam.expiresAt;
  if (!expiresAt || typeof expiresAt.toDate !== "function") return null;
  return expiresAt.toDate().toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
