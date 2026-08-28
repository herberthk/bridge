import { describe, expect, it } from "vitest";

import { EXAM_QUESTIONS_MAX } from "@/lib/constants";
import type { ExamParamsInput } from "@/lib/schemas/exam";
import { largestViableQuestionCount, outputCapFor, planGeneration } from "@/server/services/exams";

/**
 * `planGeneration` decides, before any tokens are spent, whether an exam can be
 * generated at all and how. It exists because the pipeline used to answer that
 * question the expensive way: always try the whole exam in one call, hand that
 * call every millisecond of model time, and discover 88s later that the shape
 * never fit — returning a 504 having produced nothing.
 *
 * Two reference failures anchor these tests, both real:
 *  - A-level Trigonometry, 20 questions, hints + explanations + worked examples,
 *    no documents. It must never reach a one-shot.
 *  - The same at `very_hard` with three question types, where the estimate was
 *    45% under what the model actually produced, so every chunk was handed a
 *    slice smaller than its own work and aborted by construction.
 *
 * Being pure arithmetic, this is the only part of the pipeline testable without
 * Firestore and a live model, so it is where the budget invariants belong.
 */
const params = (over: Partial<ExamParamsInput> = {}): ExamParamsInput => ({
  subject: "mathematics",
  level: "secondary",
  secondarySubLevel: "a_level",
  classLevel: 6,
  topic: "Trigonometry",
  subsidiary: null,
  difficulty: "medium",
  durationMinutes: 60,
  questionCount: 20,
  questionTypes: ["multiple_choice", "short_answer"],
  includeHints: true,
  includeExplanations: true,
  includeWorkedExamples: true,
  instructions: null,
  preventBacktrack: true,
  allowReviewBeforeSubmit: false,
  allowSkipping: true,
  requireFullscreen: true,
  enableCameraRecording: false,
  enableScreenRecording: false,
  ...over,
});

/** Wall clock `planGeneration` withholds from the model for the Firestore write. */
const SAVE_RESERVE_MS = 12_000;

/** The 150s budget less the save reserve. */
const MODEL_BUDGET_MS = 150_000 - SAVE_RESERVE_MS;

/** No extras — the cheapest shape per question. */
const bare = {
  includeHints: false,
  includeExplanations: false,
  includeWorkedExamples: false,
} as const;

describe("planGeneration: the reference failure", () => {
  const plan = planGeneration(params());

  it("refuses the one-shot that produced the 504", () => {
    // ~8,000 output tokens at the throughput measured in that run is well past
    // any slice we would grant one call, so the gamble is declined outright
    // rather than paid for and lost.
    expect(plan.fullAttemptViable).toBe(false);
    expect(plan.estFullMs).toBeGreaterThan(60_000);
  });

  it("plans a chunked run that fits with room to spare", () => {
    expect(plan.chunkSize).toBe(5);
    expect(plan.numChunks).toBe(4);
    // Four chunks fit in one wave now that six run at a time; the trailing
    // part-full wave that used to cost a full round is gone.
    expect(plan.lanes).toBe(4);
    expect(plan.waves).toBe(1);
    expect(plan.fits).toBe(true);
    expect(plan.overBudgetBy).toBe(0);
    expect(plan.projectedChunkedMs).toBeLessThan(MODEL_BUDGET_MS / 2);
  });

  it("gives each chunk a slice it can survive", () => {
    // The bug this pins: a fixed chunk slice. Whatever the chunk size, the slice
    // has to exceed what that chunk is expected to need, or chunking replaces a
    // timeout with a guaranteed one.
    expect(plan.chunkSliceMs).toBeGreaterThan(plan.projectedChunkedMs / plan.waves);
  });
});

describe("planGeneration: the product ceiling", () => {
  /**
   * The shape the ceiling exists for: the largest exam the form offers, at the
   * hardest difficulty, with every extra and a mix of question types. This is the
   * requirement — if it reports `fits: false`, the ceiling is a lie and the form
   * is offering a count the pipeline cannot deliver.
   */
  const plan = planGeneration(
    params({
      questionCount: EXAM_QUESTIONS_MAX,
      difficulty: "very_hard",
      questionTypes: ["multiple_choice", "short_answer", "fill_in_the_blank"],
    }),
  );

  it("delivers the maximum exam with every extra", () => {
    expect(EXAM_QUESTIONS_MAX).toBe(60);
    expect(plan.fits).toBe(true);
    expect(plan.overBudgetBy).toBe(0);
  });

  it("reaches the round-trip ceiling exactly at the preferred chunk size", () => {
    // 60 into twelve five-question calls. One more question would force chunks of
    // six, and the point of pinning this is that the ceiling and the maximum were
    // chosen to meet here rather than by coincidence.
    expect(plan.chunkSize).toBe(5);
    expect(plan.numChunks).toBe(12);
    expect(plan.lanes).toBe(6);
    expect(plan.waves).toBe(2);
  });

  it("still has a wave in reserve after the planned run", () => {
    // The failure this rules out: a plan that only fits when all twelve chunks
    // land first time. In the run that motivated the reserve, the one chunk that
    // succeeded did so on its *second* attempt, and there was nothing left to
    // give the others the same chance.
    const spare = MODEL_BUDGET_MS - plan.projectedChunkedMs;
    expect(spare).toBeGreaterThanOrEqual(plan.estChunkMs * 2);
  });

  it("costs more than the same count at an easier shape", () => {
    // `difficulty` and `questionTypes` were ignored by the estimator entirely,
    // which is most of why it came in 45% low on exactly this exam.
    const easier = planGeneration(
      params({ questionCount: EXAM_QUESTIONS_MAX, difficulty: "easy" }),
    );
    expect(plan.estOutputTokens).toBeGreaterThan(easier.estOutputTokens);
  });
});

describe("planGeneration: slice invariants", () => {
  const counts = [1, 5, 10, 20, 40, EXAM_QUESTIONS_MAX];
  const extras = [bare, { includeHints: true, includeExplanations: true, includeWorkedExamples: true }];

  it("never grants a call more time than the model budget holds", () => {
    for (const questionCount of counts) {
      for (const over of extras) {
        const plan = planGeneration(params({ questionCount, ...over }));
        expect(plan.fullSliceMs, `full ${questionCount}`).toBeLessThanOrEqual(MODEL_BUDGET_MS);
        expect(plan.chunkSliceMs, `chunk ${questionCount}`).toBeLessThanOrEqual(MODEL_BUDGET_MS);
      }
    }
  });

  it("never executes a plan whose chunks cannot finish in their slice", () => {
    // The whole failure mode in one assertion: a slice below the estimate aborts
    // by construction, every time, no matter how healthy the provider is. A plan
    // that cannot satisfy this is required to report `fits: false` rather than be
    // handed to the pipeline.
    for (const questionCount of counts) {
      for (const over of extras) {
        for (const difficulty of ["easy", "medium", "hard", "very_hard"] as const) {
          const plan = planGeneration(params({ questionCount, difficulty, ...over }));
          if (!plan.fits) continue;
          const estPerChunk = plan.projectedChunkedMs / plan.waves;
          expect(plan.chunkSliceMs, `${questionCount} q ${difficulty}, chunk of ${plan.chunkSize}`)
            .toBeGreaterThanOrEqual(estPerChunk);
        }
      }
    }
  });

  it("every count the form offers fits at its worst shape", () => {
    // The schema and the slider both cap at `EXAM_QUESTIONS_MAX`, so anything the
    // admin can ask for has to be deliverable. A count that the form accepts and
    // the planner refuses is a 400 the admin cannot act on.
    for (let questionCount = 1; questionCount <= EXAM_QUESTIONS_MAX; questionCount += 1) {
      const plan = planGeneration(
        params({
          questionCount,
          difficulty: "very_hard",
          questionTypes: ["multiple_choice", "short_answer", "fill_in_the_blank"],
        }),
      );
      expect(plan.fits, `${questionCount} q at the worst shape`).toBe(true);
    }
  });

  it("keeps a viable one-shot's slice fundable alongside the fallback", () => {
    // A one-shot is only worth attempting if losing it still leaves the chunked
    // path enough model time to finish — otherwise the gamble costs the exam.
    for (const questionCount of counts) {
      for (const over of extras) {
        const plan = planGeneration(params({ questionCount, ...over }));
        if (!plan.fullAttemptViable) continue;
        expect(plan.fullSliceMs + plan.projectedChunkedMs, `${questionCount} q`)
          .toBeLessThanOrEqual(MODEL_BUDGET_MS);
      }
    }
  });

  it("never plans more chunks than the round-trip ceiling allows", () => {
    for (const questionCount of counts) {
      const plan = planGeneration(params({ questionCount }));
      expect(plan.numChunks, `${questionCount} q`).toBeLessThanOrEqual(12);
      expect(plan.chunkSize * plan.numChunks).toBeGreaterThanOrEqual(questionCount);
    }
  });
});

/**
 * The output cap is the limit whose failure mode is silent. On Gemini 3
 * `maxOutputTokens` is a hard stop mid-token-stream: the JSON ends unterminated,
 * nothing parses, and the SDK throws `NoOutputGeneratedError` — which carries no
 * finish reason, so a cap that is 15 tokens too small is indistinguishable from a
 * model that returned prose. That is exactly what happened: two of five
 * identically-shaped chunks stopped at 7,243 output tokens against a 7,258-token
 * cap, each burning a full round trip, while their siblings finished at 2,592 and
 * 2,891. These pin the arithmetic that made the ceiling that low.
 */
describe("outputCapFor: the truncation ceiling", () => {
  /** The shape that truncated: five questions, `very_hard`, every extra. */
  const referenceChunk = planGeneration(
    params({ questionCount: 5, difficulty: "very_hard" }),
  );

  /** The largest single response the reference run produced before being cut off. */
  const TRUNCATED_AT_TOKENS = 7_243;
  /** The smallest complete response in that same run — mostly fixed overhead. */
  const SMALLEST_COMPLETE_TOKENS = 2_592;
  /**
   * The largest *complete* response measured over six round trips once constrained
   * decoding was turned off (the arm ran 2,416–2,894 output tokens).
   */
  const LARGEST_COMPLETE_TOKENS = 2_894;

  it("clears the length that was truncated", () => {
    // The regression in one line. Under the old 2.5× headroom this was 7,258.
    expect(referenceChunk.chunkOutputCap).toBeGreaterThan(TRUNCATED_AT_TOKENS);
  });

  it("leaves a `length` finish no innocent explanation", () => {
    // This replaces an assertion that a truncation retry must be *wider*, which was
    // built on the theory that a `length` finish meant the model had run out of
    // room. It does not: with `structuredOutputs: false` a healthy chunk lands
    // around 2,400–2,900 output tokens, and the five failures in that same
    // measurement all sat at 14,465 — the model repeating itself into the ceiling.
    // `genSingle` now re-rolls the sample at the same cap, and that is only sound
    // while the cap stays far enough above the honest spread that reaching it
    // cannot mean a legitimately longer answer.
    expect(referenceChunk.chunkOutputCap).toBeGreaterThan(LARGEST_COMPLETE_TOKENS * 3);
  });

  it("gives a one-question top-up room for a whole response", () => {
    // A top-up pays the fixed cost of a response again — title, JSON scaffolding,
    // the opening of reasoning — so its cap cannot be a proportional sliver of a
    // full chunk's. Without this, the short-chunk recovery path truncates on the
    // very call meant to complete the exam.
    const oneQuestion = planGeneration(
      params({ questionCount: 1, difficulty: "very_hard" }),
    ).estOutputTokens;
    expect(outputCapFor(oneQuestion, 4)).toBeGreaterThan(SMALLEST_COMPLETE_TOKENS);
  });

  it("stays inside the model's own ceiling at every shape", () => {
    // The clamp matters most where it is least likely to be exercised by hand: the
    // largest exam the form offers, at the most output-hungry question mix.
    for (let questionCount = 1; questionCount <= EXAM_QUESTIONS_MAX; questionCount += 1) {
      const plan = planGeneration(
        params({
          questionCount,
          difficulty: "very_hard",
          questionTypes: ["multiple_choice", "short_answer", "fill_in_the_blank"],
        }),
      );
      expect(plan.chunkOutputCap, `${questionCount} q`).toBeLessThanOrEqual(64_000);
      // A cap at or below the estimate is a guaranteed truncation, so the ordering
      // is the invariant rather than either number.
      expect(plan.chunkOutputCap, `${questionCount} q`).toBeGreaterThan(plan.estOutputTokens / plan.numChunks);
    }
  });
});

describe("planGeneration: what fits and what doesn't", () => {
  it("lets a small exam try the one-shot", () => {
    // Chunking costs round trips, so it must stay a fallback rather than become
    // the default for everything.
    expect(planGeneration(params({ questionCount: 10, ...bare })).fullAttemptViable).toBe(true);
  });

  it("reports `fits: false` when the chunk outgrows the slice ceiling", () => {
    // Deliberately past `EXAM_QUESTIONS_MAX`: the schema makes this unreachable
    // today, and this asserts the guard is still there for whoever raises the
    // ceiling. At 200 questions `MAX_CHUNKS` forces chunks of 17 — a ~76s call
    // against a 50s slice ceiling, so it aborts however healthy the provider is.
    const plan = planGeneration(params({ questionCount: 200 }));
    expect(plan.chunkSize).toBeGreaterThan(5);
    expect(plan.estChunkMs).toBeGreaterThan(plan.chunkSliceMs);
    expect(plan.fits).toBe(false);
  });

  it("rejects a shape whose chunks cannot all be paid for", () => {
    // Driven by the budget rather than an out-of-range count, because that is the
    // constraint that actually varies at runtime: the plan is built from whatever
    // wall clock is left, not from a fixed pool. Here the planned work alone
    // overruns it, before any reserve is considered.
    const plan = planGeneration(params({ questionCount: EXAM_QUESTIONS_MAX }), 45_000);
    expect(plan.projectedChunkedMs).toBeGreaterThan(plan.modelBudgetMs);
    expect(plan.fits).toBe(false);
    expect(plan.overBudgetBy).toBeGreaterThan(0);
  });

  it("charges a retry wave against the budget", () => {
    // A run that fits only if nothing goes wrong must report `fits: false`. The
    // budget is derived from the plan rather than hard-coded, because a hard-coded
    // one only sits on this margin at one particular throughput: recalibrating
    // `PLANNING_TOKENS_PER_SECOND` moved the old 62,000 off it by 80ms, failing the
    // test without anything being wrong with the rule it exists to pin. Pick a
    // budget the planned work clears but the planned work *plus a retry wave* does
    // not, whatever those numbers currently are.
    const shape = params({ questionCount: 45 });
    const { projectedChunkedMs, estChunkMs } = planGeneration(shape);
    const plan = planGeneration(
      shape,
      projectedChunkedMs + Math.round(estChunkMs / 2) + SAVE_RESERVE_MS,
    );
    expect(plan.projectedChunkedMs).toBeLessThanOrEqual(plan.modelBudgetMs);
    expect(plan.projectedChunkedMs + plan.estChunkMs).toBeGreaterThan(plan.modelBudgetMs);
    expect(plan.fits).toBe(false);
  });

  it("scales with the extras, not just the question count", () => {
    const cheap = planGeneration(params({ questionCount: 40, ...bare }));
    const loaded = planGeneration(params({ questionCount: 40 }));
    expect(loaded.estOutputTokens).toBeGreaterThan(cheap.estOutputTokens * 2);
    expect(loaded.projectedChunkedMs).toBeGreaterThan(cheap.projectedChunkedMs);
  });

  it("is reproducible for the same input", () => {
    // No clock reads, no randomness — the plan a request is rejected on is the
    // same plan a retry would get.
    expect(planGeneration(params())).toEqual(planGeneration(params()));
  });

  it("honours a smaller budget", () => {
    const fits = planGeneration(params(), 100_000);
    const doesnt = planGeneration(params(), 40_000);
    expect(fits.fits).toBe(true);
    expect(doesnt.fits).toBe(false);
    expect(doesnt.overBudgetBy).toBeGreaterThan(0);
  });
});

describe("largestViableQuestionCount", () => {
  /** A budget too small for the full 60, so there is a boundary to find. */
  const TIGHT_BUDGET_MS = 60_000;

  it("returns a count that actually fits", () => {
    const requested = params({ questionCount: EXAM_QUESTIONS_MAX });
    const viable = largestViableQuestionCount(requested, TIGHT_BUDGET_MS);
    expect(viable).toBeLessThan(EXAM_QUESTIONS_MAX);
    expect(planGeneration({ ...requested, questionCount: viable }, TIGHT_BUDGET_MS).fits).toBe(true);
  });

  it("finds the boundary, not a round number below it", () => {
    // The projection moves in steps — one more question can add a whole wave —
    // so the answer is searched rather than scaled. This pins that the result is
    // maximal: one more question must not fit.
    const requested = params({ questionCount: EXAM_QUESTIONS_MAX });
    const viable = largestViableQuestionCount(requested, TIGHT_BUDGET_MS);
    expect(
      planGeneration({ ...requested, questionCount: viable + 1 }, TIGHT_BUDGET_MS).fits,
    ).toBe(false);
  });

  it("leaves a request that already fits alone", () => {
    expect(largestViableQuestionCount(params({ questionCount: 20 }))).toBe(20);
    expect(largestViableQuestionCount(params({ questionCount: EXAM_QUESTIONS_MAX })))
      .toBe(EXAM_QUESTIONS_MAX);
  });

  it("never suggests fewer than one chunk's worth", () => {
    expect(largestViableQuestionCount(params({ questionCount: EXAM_QUESTIONS_MAX }), 1_000)).toBe(5);
  });
});
