import { NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import { describe, expect, it } from "vitest";

import {
  isAbortError,
  isRetryableAiError,
  isTransientTransportError,
} from "@/server/services/exams";

/**
 * These predicates decide how the generation pipeline spends a 100s budget
 * against a 120s `maxDuration`, so a misread error costs real wall clock. They
 * used to test `err.message` against `/NoObjectGenerated/` — a spelling the SDK
 * never emits (its message reads "No object generated: could not parse the
 * response."), which silently reclassified the single most common failure as
 * permanent. Build the errors the SDK actually throws rather than the strings we
 * assume it throws.
 */
/** Usage is irrelevant to classification, but the constructor requires a full shape. */
const usage = {
  inputTokens: 10,
  inputTokenDetails: {
    noCacheTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 20,
  outputTokenDetails: { textTokens: 20, reasoningTokens: 0 },
  totalTokens: 30,
};

const noObject = (message?: string) =>
  new NoObjectGeneratedError({
    message,
    text: "{ malformed",
    response: { id: "r1", timestamp: new Date(0), modelId: "gemini-2.5-flash" },
    usage,
    finishReason: "stop",
  });

/** What `AbortSignal.timeout` rejects with, as opposed to a manual `abort()`. */
const timeoutError = () => {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
};

const abortError = () => {
  const e = new Error("The operation was aborted");
  e.name = "AbortError";
  return e;
};

const withStatus = (status: number) =>
  Object.assign(new Error(`Request failed`), { statusCode: status });

describe("isAbortError", () => {
  it("recognises both abort flavours", () => {
    expect(isAbortError(timeoutError())).toBe(true);
    expect(isAbortError(abortError())).toBe(true);
  });

  it("finds an abort the SDK wrapped as a cause", () => {
    const wrapped = new Error("AI_RetryError: failed after 2 attempts", {
      cause: new Error("call failed", { cause: timeoutError() }),
    });
    expect(isAbortError(wrapped)).toBe(true);
  });

  it("does not walk a cause chain forever", () => {
    // A self-referential cause is degenerate but cheap to survive; hanging the
    // request to classify an error would be worse than misclassifying it.
    const loop: Error & { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    expect(isAbortError(loop)).toBe(false);
  });

  it("ignores unrelated failures", () => {
    expect(isAbortError(noObject())).toBe(false);
    expect(isAbortError(withStatus(503))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("aborted")).toBe(false);
  });
});

describe("isTransientTransportError", () => {
  it("accepts the overload statuses worth re-issuing the same call for", () => {
    for (const status of [429, 502, 503]) {
      expect(isTransientTransportError(withStatus(status)), `status ${status}`).toBe(true);
      expect(
        isTransientTransportError(Object.assign(new Error("x"), { status })),
        `status field ${status}`,
      ).toBe(true);
    }
  });

  it("reads overload wording when no status is attached", () => {
    expect(isTransientTransportError(new Error("The model is overloaded"))).toBe(true);
    expect(isTransientTransportError(new Error("503 UNAVAILABLE"))).toBe(true);
    expect(isTransientTransportError(new Error("high demand, try later"))).toBe(true);
    expect(isTransientTransportError(new Error("rate limit exceeded"))).toBe(true);
  });

  it("rejects a parse failure, so it routes to the text fallback instead", () => {
    // Re-issuing the identical structured call tends to repeat the outcome. The
    // `generateText` + `Output.object` path is the one that actually recovers.
    expect(isTransientTransportError(noObject())).toBe(false);
  });

  it("rejects an abort — the budget it overran is already gone", () => {
    expect(isTransientTransportError(timeoutError())).toBe(false);
  });

  it("requires a word boundary around a bare status code", () => {
    // The message check is a fallback for providers that attach no status, so it
    // is deliberately loose — a bare `503` anywhere still counts, and this pins
    // that known false positive rather than pretending it does not exist.
    expect(isTransientTransportError(new Error("generated 503 questions"))).toBe(true);
    // The boundary does stop the digits appearing inside a longer number, which
    // is where the loose form actually caused trouble: token counts and ids.
    expect(isTransientTransportError(new Error("token 4293 was invalid"))).toBe(false);
    expect(isTransientTransportError(new Error("exam 15029 not found"))).toBe(false);
  });
});

describe("isRetryableAiError", () => {
  it("retries the parse failure the old regex missed", () => {
    // The regression that mattered: with the default message, the old pattern
    // returned false, so no backoff ran before the next full attempt.
    const err = noObject();
    expect(err.message).toContain("No object generated");
    expect(isRetryableAiError(err)).toBe(true);
  });

  it("retries a missing-output failure", () => {
    const err = new NoOutputGeneratedError({});
    expect(isRetryableAiError(err)).toBe(true);
  });

  it("retries transport overload", () => {
    expect(isRetryableAiError(withStatus(503))).toBe(true);
  });

  it("never retries an abort", () => {
    expect(isRetryableAiError(timeoutError())).toBe(false);
    expect(isRetryableAiError(abortError())).toBe(false);
  });

  it("does not retry a genuine dead end", () => {
    expect(isRetryableAiError(withStatus(401))).toBe(false);
    expect(isRetryableAiError(new Error("Invalid API key"))).toBe(false);
    expect(isRetryableAiError(null)).toBe(false);
  });
});
