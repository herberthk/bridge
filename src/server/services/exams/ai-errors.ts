import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";

/**
 * `AbortSignal.timeout` rejects with a `TimeoutError` and a manual abort with an
 * `AbortError`, but the SDK may surface either wrapped as a `cause`. Retrying an
 * aborted call is always pointless — the budget it overran is already gone.
 */
export function isAbortError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth += 1) {
    const name = (e as { name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Transport-level overload, where re-issuing the very same call can succeed.
 * A model that returned unusable JSON is *not* in this set: repeating the
 * request tends to repeat the outcome, so that case goes to the text fallback.
 */
export function isTransientTransportError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  const e = err as { statusCode?: number; status?: number } | null;
  const status = e?.statusCode ?? e?.status;
  if (status === 429 || status === 502 || status === 503) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|502|503)\b|UNAVAILABLE|high demand|overloaded|rate.?limit/i.test(msg);
}

/** Worth another *outer* attempt (with backoff), not necessarily an immediate retry. */
export function isRetryableAiError(err: unknown): boolean {
  if (isAbortError(err)) return false;
  // These carry messages like "No object generated: could not parse the
  // response." — which never matched the `NoObjectGenerated` spelling this used
  // to grep for, so the single most common failure was misread as permanent.
  if (NoObjectGeneratedError.isInstance(err) || NoOutputGeneratedError.isInstance(err)) {
    return true;
  }
  return isTransientTransportError(err);
}

/** Normalize provider usage into a total plus an input/output split. */
export function readUsage(
  usage:
    | { totalTokens?: number; inputTokens?: number; outputTokens?: number }
    | undefined,
): { tokens: number; inputTokens: number; outputTokens: number } {
  const inputTokens = usage?.inputTokens ?? 0;
  const reportedOutput = usage?.outputTokens ?? 0;
  const tokens = usage?.totalTokens ?? inputTokens + reportedOutput;
  return {
    tokens,
    inputTokens,
    // Providers that report only a total still get a usable split.
    outputTokens: reportedOutput || Math.max(0, tokens - inputTokens),
  };
}
