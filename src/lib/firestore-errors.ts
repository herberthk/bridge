/**
 * Firestore backend error classifiers — pure, so server services and pages
 * share one definition of "this query needs a composite index".
 *
 * The Admin SDK surfaces a missing composite index as FAILED_PRECONDITION
 * (gRPC code 9) with a message containing a console link to create it.
 */
export function isMissingIndexError(err: unknown): boolean {
  const code = (err as { code?: number | string } | null)?.code;
  if (code === 9 || code === "failed-precondition" || code === "FAILED_PRECONDITION")
    return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /requires an index|FAILED_PRECONDITION|missing.*index/i.test(msg);
}
