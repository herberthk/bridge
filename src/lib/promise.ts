/**
 * Race a promise against a timeout so a slow or non-settling source degrades
 * instead of blocking the caller. The underlying operation is NOT cancelled —
 * the loser keeps running server-side — so use this to bound rendering, not
 * to bound billable work.
 *
 * Pure w.r.t. side effects beyond the timer (unit-tested).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
