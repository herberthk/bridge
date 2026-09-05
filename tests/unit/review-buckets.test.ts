import { describe, expect, it } from "vitest";

import { bucketFor, summarizeMarks, weightShare } from "@/lib/exam/review-buckets";
import { hasAnswer } from "@/server/services/attempts";
import type { AttemptAnswer } from "@/types/firestore";

function ans(
  response: AttemptAnswer["response"],
  graded: AttemptAnswer["graded"],
): AttemptAnswer {
  return { questionId: "q", type: "multiple_choice", response, graded };
}

describe("bucketFor", () => {
  it("buckets missing answers as skipped", () => {
    expect(bucketFor(undefined)).toBe("skipped");
    expect(bucketFor(ans(null, null))).toBe("skipped");
    expect(bucketFor(ans("", null))).toBe("skipped");
    expect(bucketFor(ans("   ", null))).toBe("skipped");
    expect(bucketFor(ans([], null))).toBe("skipped");
    expect(bucketFor(ans(["", "  "], null))).toBe("skipped");
  });
  it("buckets a blank objective answer as skipped even though it graded correct:false", () => {
    // gradeOne marks an untouched MCQ wrong — the review must still read "left blank".
    expect(
      bucketFor(ans(null, { earned: 0, possible: 5, correct: false, feedback: null })),
    ).toBe("skipped");
  });
  it("follows the graded verdict for answered questions", () => {
    expect(
      bucketFor(ans(1, { earned: 5, possible: 5, correct: true, feedback: null })),
    ).toBe("correct");
    expect(
      bucketFor(ans(0, { earned: 0, possible: 5, correct: false, feedback: null })),
    ).toBe("failed");
  });
  it("counts partial credit as failed (correct means full marks)", () => {
    expect(
      bucketFor(ans("essay…", { earned: 7, possible: 10, correct: false, feedback: "Ok" })),
    ).toBe("failed");
  });
  it("sends ungraded-but-answered to the side that earned marks", () => {
    expect(
      bucketFor(ans("essay…", { earned: 3, possible: 10, correct: null, feedback: null })),
    ).toBe("correct");
    expect(
      bucketFor(ans("essay…", { earned: 0, possible: 10, correct: null, feedback: null })),
    ).toBe("failed");
  });
});

describe("summarizeMarks", () => {
  it("splits counts, earned and possible per bucket", () => {
    expect(
      summarizeMarks([
        { points: 5, earned: 5, bucket: "correct" },
        { points: 10, earned: 7, bucket: "failed" },
        { points: 10, earned: 0, bucket: "failed" },
        { points: 5, earned: 0, bucket: "skipped" },
      ]),
    ).toEqual({
      correct: { count: 1, earned: 5, possible: 5 },
      failed: { count: 2, earned: 7, possible: 20 },
      skipped: { count: 1, earned: 0, possible: 5 },
    });
  });
  it("returns zeros for an empty paper", () => {
    expect(summarizeMarks([])).toEqual({
      correct: { count: 0, earned: 0, possible: 0 },
      failed: { count: 0, earned: 0, possible: 0 },
      skipped: { count: 0, earned: 0, possible: 0 },
    });
  });
});

describe("weightShare", () => {
  it("returns the question's share of the paper in percent", () => {
    expect(weightShare(8, 100)).toBe(8);
    expect(weightShare(1, 3)).toBe(33.3);
    expect(weightShare(0, 100)).toBe(0);
  });
  it("returns null when there is nothing to weigh against", () => {
    expect(weightShare(5, 0)).toBeNull();
    expect(weightShare(0, 0)).toBeNull();
  });
});

describe("submit/review agreement", () => {
  it("hasAnswer and bucketFor agree on attempted vs blank", () => {
    const responses: unknown[] = [
      null,
      undefined,
      "",
      "   ",
      [],
      ["", "  "],
      "Paris",
      ["", "Paris"],
      0,
      false,
    ];
    for (const response of responses) {
      const attempted = hasAnswer(response);
      const bucket = bucketFor({
        questionId: "q",
        type: "essay",
        response: response as AttemptAnswer["response"],
        graded: null,
      });
      expect(bucket === "skipped").toBe(!attempted);
    }
  });
});
