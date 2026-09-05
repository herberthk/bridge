import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "@/lib/promise";

describe("withTimeout", () => {
  it("resolves with the inner value when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "fast")).resolves.toBe(42);
  });

  it("rejects with the inner error when it fails in time", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "sad")).rejects.toThrow(
      "boom",
    );
  });

  it("rejects with a labelled timeout error when the promise never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise(() => {}), 1000, "stuck source");
      const assertion = expect(pending).rejects.toThrow(/stuck source timed out after 1000ms/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer when the promise settles first", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      await withTimeout(Promise.resolve("ok"), 10_000, "fast");
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });
});
