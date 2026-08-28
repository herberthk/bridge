import { describe, expect, it } from "vitest";

import { clampProse } from "@/server/services/exams";

/**
 * `clampProse` is the storage-side half of the repetition guard. Turning off
 * constrained decoding (see `structuredOutputs` in `exams.ts`) made
 * `gemini-3.7-flash`'s repetition collapse rare rather than impossible, and the
 * variant that survives to this point is the one that terminates on its own: it
 * parses, it validates against `examOutputSchema`, and without this it persists and
 * is shown to a student.
 */

/** Verbatim from a real collapsed `workedExample`, which ran to 14,740 characters. */
const LOOP_PHRASE =
  "pi over 12, 5 pi over 12, and pi over 2 directly without extraneous roots in range ";

/** The part of that same response that was still doing useful work. */
const GOOD_PREFIX =
  "First apply the sum-to-product identity to sin 3 theta plus sin theta, giving " +
  "2 sin 2 theta cos theta. Next factor out cos theta to get cos theta times " +
  "(2 sin 2 theta minus 1) equals zero. Then set cos theta to zero, giving theta " +
  "equals pi over 2. Finally set sin 2 theta to one half. Combining all solutions " +
  "within the given interval gives ";

describe("clampProse: absent or unusable values", () => {
  it("returns null for anything that isn't text", () => {
    expect(clampProse(null)).toBeNull();
    expect(clampProse(undefined)).toBeNull();
    expect(clampProse(42)).toBeNull();
    expect(clampProse({ text: "hi" })).toBeNull();
    expect(clampProse([])).toBeNull();
  });

  it("treats blank and whitespace-only text as absent", () => {
    // Firestore stores the null happily; an empty string would render as an empty
    // hint box next to the question.
    expect(clampProse("")).toBeNull();
    expect(clampProse("   \n\t ")).toBeNull();
  });

  it("trims surrounding whitespace but keeps the text", () => {
    expect(clampProse("  Use the double-angle identity.  ")).toBe(
      "Use the double-angle identity.",
    );
  });
});

describe("clampProse: length", () => {
  it("leaves a normal field exactly as written", () => {
    // The healthy spread measured over six round trips topped out at 781 chars, so
    // ordinary output must pass through untouched rather than near-untouched.
    const explanation = `Because $\\sin 2\\theta = 2\\sin\\theta\\cos\\theta$, ${"the identity reduces the equation to a product of two factors. ".repeat(5)}`;
    expect(clampProse(explanation)).toBe(explanation.trim());
  });

  it("caps an over-long field and marks the cut", () => {
    // Varied on purpose: a long field made of one repeated character is a loop, and
    // would be cut by the repetition guard before the length cap ever applied.
    const long = Array.from(
      { length: 80 },
      (_, i) => `Consider the case where $n = ${i}$ and the angle measures ${i * 3} degrees.`,
    ).join(" ");
    expect(long.length).toBeGreaterThan(1_200);

    const out = clampProse(long)!;
    expect(out.length).toBeLessThanOrEqual(1_201); // 1,200 plus the ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("Consider the case where $n = 0$")).toBe(true);
  });

  it("treats a field of one repeated character as a loop, not a long field", () => {
    // No ellipsis here: nothing was truncated for length, the string was cut where
    // it stopped carrying information.
    const out = clampProse("a".repeat(5_000))!;
    expect(out).toBe("a".repeat(60));
  });
});

describe("clampProse: repetition collapse", () => {
  it("cuts a looping field where the loop starts and keeps the good prose", () => {
    const collapsed = GOOD_PREFIX + LOOP_PHRASE.repeat(40);
    expect(collapsed.length).toBeGreaterThan(3_000);

    const out = clampProse(collapsed)!;
    // The salvaged derivation survives...
    expect(out.startsWith("First apply the sum-to-product identity")).toBe(true);
    // ...and the loop does not. One occurrence is the clause the model was
    // legitimately writing when it got stuck; three is the collapse.
    expect(out.split(LOOP_PHRASE).length - 1).toBeLessThan(2);
    expect(out.length).toBeLessThan(GOOD_PREFIX.length + LOOP_PHRASE.length * 2);
  });

  it("catches a loop with no salvageable prefix at all", () => {
    const out = clampProse(LOOP_PHRASE.repeat(60));
    // Cut at the second occurrence, so exactly the first clause is left. The
    // question keeps its prompt and answer; only the worked example is lost.
    expect(out).toBe(LOOP_PHRASE.trimEnd());
  });

  it("does not fire on prose that is merely repetitive in shape", () => {
    // The dangerous false positive: a worked example whose steps are deliberately
    // parallel, or a hint that restates the question's own wording. Half the field
    // has to be verbatim repeats of one 60-character window before it is a loop, and
    // real writing does not reach that even when its structure rhymes.
    const stepwise = [
      "Step 1: rewrite $\\sin 3\\theta + \\sin\\theta$ as a product using sum-to-product.",
      "Step 2: rewrite the right-hand side so both sides share a common factor.",
      "Step 3: factor out $\\cos\\theta$ and set each factor equal to zero in turn.",
      "Step 4: solve $\\cos\\theta = 0$ on the given interval for the first family.",
      "Step 5: solve $\\sin 2\\theta = \\tfrac12$ for the remaining two solutions.",
      "Step 6: discard any root that falls outside the stated interval.",
    ].join("\n");
    expect(stepwise.length).toBeGreaterThan(400); // long enough to be tested at all
    expect(clampProse(stepwise)).toBe(stepwise);
  });

  it("ignores short text entirely, however it reads", () => {
    // Below 400 chars there is not enough material to tell a loop from a refrain,
    // and a short field costs nothing to keep.
    const chant = "Use the identity. ".repeat(10);
    expect(chant.length).toBeLessThan(400);
    expect(clampProse(chant)).toBe(chant.trim());
  });
});
