import type { AttemptAnswer } from "@/types/firestore";

/**
 * Review grouping for the student results view — pure and DOM-free so the
 * bucket semantics (in particular the skipped-first ordering) are locked by
 * unit tests rather than by inspection of a client component.
 */

export type ReviewBucket = "correct" | "failed" | "skipped";
export type ReviewFilter = "all" | ReviewBucket;

/**
 * One stored answer → its review bucket.
 *
 * "Skipped" is checked before `graded.correct` on purpose: the deterministic
 * grader marks untouched objective answers `correct: false` (a blank MCQ is
 * "wrong"), but the student experience must read "left blank", not "failed".
 * "Correct" uniformly means full marks — partial credit lands failed-side,
 * matching both graders (`gradeOne` is all-or-nothing; AI `correct` requires
 * `earned >= possible`).
 */
export function bucketFor(ans: AttemptAnswer | undefined): ReviewBucket {
  if (!ans || !hasResponse(ans.response)) return "skipped";
  return bucketForGraded(ans);
}

/**
 * Whether a stored response counts as attempted.
 *
 * Single source of truth for blank detection, shared by the submit path
 * (`hasAnswer` in the attempts service re-exports this) and the review path
 * (`bucketFor` below) — the two must never disagree on what "unanswered"
 * means, or an attempt finalized as skipped shows up as failed.
 */
export function hasResponse(response: unknown): boolean {
  if (response === null || response === undefined) return false;
  if (typeof response === "string") return response.trim().length > 0;
  if (Array.isArray(response))
    return response.some((v) => {
      if (v === "" || v === null || v === undefined) return false;
      return typeof v !== "string" || v.trim().length > 0;
    });
  return true;
}

function bucketForGraded(ans: AttemptAnswer): ReviewBucket {
  if (ans.graded?.correct === true) return "correct";
  if (ans.graded?.correct === false) return "failed";
  // Ungraded-but-answered (e.g. AI feedback pending): count as correct-side only
  // when marks were earned, otherwise failed-side so it still gets attention.
  return (ans.graded?.earned ?? 0) > 0 ? "correct" : "failed";
}

/** One question's contribution to the score: its weight and what was earned. */
export interface MarkEntry {
  points: number;
  earned: number;
  bucket: ReviewBucket;
}

export interface BucketMarks {
  count: number;
  earned: number;
  possible: number;
}

export type MarksBreakdown = Record<ReviewBucket, BucketMarks>;

/**
 * Score composition per bucket — the answer to "11 correct, so why 22%?".
 * Question counts never set the score; marks do, and buckets carry very
 * different weights. Pure so the hero bar and the assessment panel share it.
 */
export function summarizeMarks(entries: MarkEntry[]): MarksBreakdown {
  const out: MarksBreakdown = {
    correct: { count: 0, earned: 0, possible: 0 },
    failed: { count: 0, earned: 0, possible: 0 },
    skipped: { count: 0, earned: 0, possible: 0 },
  };
  for (const e of entries) {
    const b = out[e.bucket];
    b.count += 1;
    b.earned += e.earned;
    b.possible += e.points;
  }
  return out;
}

/**
 * One question's weight as a share of the paper, in percent with one-decimal
 * precision (8, 33.3). Null when the paper carries no marks — callers hide
 * the weight line instead of printing "0%".
 */
export function weightShare(points: number, paperTotal: number): number | null {
  if (paperTotal <= 0 || points < 0) return null;
  return Math.round((points / paperTotal) * 1000) / 10;
}
