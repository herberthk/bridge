import type { JSONValue } from "ai";

import type { GenerateExamInput } from "@/lib/schemas/exam";
import type { Difficulty } from "@/lib/constants";
import { ExamsServiceError } from "./errors";

/**
 * Wall-clock budget for the whole generation pipeline.
 *
 * The route declares `maxDuration = 180`, so work still running past that is
 * killed mid-flight — after tokens are spent, and possibly between the Firestore
 * write and the billing call. Retries plus the chunked fallback can blow through
 * that on their own, so every attempt checks the clock first and the pipeline
 * fails with an actionable message rather than being killed halfway. The ~30s
 * between this and `maxDuration` covers request parsing, the document reads and
 * the response itself, none of which this clock is started for.
 *
 * Raised from 100s to fund the stated product requirement: 60 questions with
 * hints, explanations *and* worked examples is ~31,000 output tokens, which is more
 * model time than 120s can hold even spread across six concurrent chunks.
 * `GENERATION_BUDGET_MS` in the service is set 30s under this, and that gap is the
 * part of the request this clock covers but that budget does not — auth, the
 * document reads, the Firestore write and serialising the response.
 */
export const GENERATION_BUDGET_MS = 150_000;

/**
 * Ceiling on chunked-fallback round trips, so large exams stay inside the budget.
 *
 * Twelve because 60 questions — the largest exam the product offers — divides
 * into twelve five-question chunks, and five is the size that reliably comes back
 * whole. At the old ceiling of eight, 60 questions forced chunks of eight, and a
 * chunk that size is a ~46s call: past the point where one request is a good bet.
 */
const MAX_CHUNKS = 12;

/**
 * Preferred chunk size — the fallback never issues calls smaller than this.
 *
 * Five questions with all three extras is a small enough ask to come back whole,
 * and going below it would only buy round trips. It grows above this only when
 * `MAX_CHUNKS` forces it, which is the trade `planGeneration` has to price.
 */
export const MIN_CHUNK_QUESTIONS = 5;

/**
 * Chunks in flight at once.
 *
 * This is the only lever that makes a large exam possible at all. Generation is
 * throughput-bound — 60 questions with every extra is ~350s of serial model work
 * — so the exam fits or doesn't fit on how many lanes carry it: twelve chunks
 * across six lanes is two waves of ~29s, which the budget holds with room for a
 * whole extra wave of retries. Three lanes made it four waves and ~116s, past the
 * pool with nothing left over.
 *
 * Six is a real fan-out and the trade is deliberate: it raises the chance of a
 * 429, which the chunk loop already treats as retryable and escalates to Pro on.
 * The alternative is refusing the exam, since no amount of retrying makes three
 * lanes fast enough.
 */
const CHUNK_CONCURRENCY = 6;

/**
 * Full-exam attempts before falling back to chunking.
 *
 * Three attempts × the 25s floor is 75s of an 88s pool, which starved the
 * chunked fallback of any runway at all. Two attempts leave roughly half the
 * budget for it — and each attempt already contains its own ladder (an explicit
 * thinking budget, then an untuned retry), so a third adds little.
 */
export const MAX_FULL_ATTEMPTS = 2;

/**
 * Held back from the budget so the Firestore write, the token deduction and the
 * audit entry still fit after the last model call returns.
 */
export const SAVE_RESERVE_MS = 12_000;

/**
 * Retries *inside* one SDK call. The default of 2 means 3 HTTP round trips per
 * call, and `genSingle` makes up to two calls — so at the default that is 6 round
 * trips before the outer loop sees a single failure, which is how one attempt
 * consumed 116s of a 120s `maxDuration`. The outer loop already retries with
 * backoff and escalates to Pro, so the inner retry only needs to absorb a one-off
 * blip.
 */
export const AI_CALL_RETRIES = 1;

/**
 * Hard ceiling on one full-exam model call, independent of how much budget is
 * left.
 *
 * Without it, `msLeft() - SAVE_RESERVE_MS` handed the very first call all 88s of
 * model time. An A-level Trigonometry set — 20 questions with hints,
 * explanations *and* worked examples — was still generating when the signal
 * fired at 88,056ms, so the request died having produced nothing, and the
 * chunked fallback that splits exactly this shape into five-question calls never
 * got to run. Capping the slice is what makes the fallback reachable.
 */
const MAX_CALL_SLICE_MS = 50_000;

/** Floor on a call's slice — below this a call can't finish anything useful. */
export const MIN_CALL_SLICE_MS = 15_000;

/**
 * Multiplier from "how long we estimate this call needs" to "how long we let it
 * run".
 *
 * Raised from 1.6 because the estimate tracks the *mean* and the slice has to
 * survive the *spread*, and the spread is much wider than 1.6× . Five chunks of
 * identical shape in one run produced 2,592 / 2,891 / 3,187 / 3,715 output tokens
 * and two more that wanted over 7,243 — a range of at least 2.8× on requests that
 * differ only in their random seed. A slice at 1.6× the mean cuts off an ordinary
 * outlier, and cutting one off costs a whole attempt.
 *
 * Nearly free in the plan: `projectedChunkedMs` is costed from `estChunkMs`, not
 * from the slice, so headroom only widens the ceiling a struggling call is allowed
 * to reach. It is bounded by `MAX_CALL_SLICE_MS` regardless.
 */
const SLICE_HEADROOM = 2.5;

/**
 * Ceiling on `maxOutputTokens` for one response, just under the 65,536 the Gemini 3
 * flash models document.
 *
 * Only a backstop: at the product's own ceiling — 60 questions, `very_hard`, three
 * question types, every extra — the sizing below asks for about 15,000, and 24,700
 * on a truncation retry. Nothing in normal operation reaches this; it exists so a
 * future estimator change cannot produce a request the provider rejects outright.
 */
const MODEL_MAX_OUTPUT_TOKENS = 64_000;

/**
 * Multiplier from the token estimate to `maxOutputTokens` for a first attempt.
 *
 * Raised from 2.5 because 2.5 was the direct cause of an earlier failure. On
 * Gemini 3 the cap is a hard stop mid-token-stream: the model is cut off, the JSON
 * is left unterminated, and `generateText` reports `finishReason: "length"` and
 * throws `NoOutputGeneratedError`. Two of five identical five-question chunks hit
 * exactly that — 7,243 output tokens against a 7,258 cap — while their siblings
 * finished comfortably at 2,592 and 2,891.
 *
 * Headroom here is close to free. Billing is per token *produced*, so a cap the
 * model does not reach costs nothing, and wall clock is bounded separately by the
 * slice. A cap set too low, by contrast, costs the entire round trip that hit it.
 * The asymmetry is the whole argument for being generous.
 *
 * Note what this multiplier can and cannot buy. It protects a response that is
 * legitimately longer than estimated. It does nothing for a response that is not
 * going to terminate at any cap — see `structuredOutputs` in `genSingle`, where a
 * `length` finish turned out to mean the model was repeating itself, and raising
 * the cap from 7,258 to 14,480 to 23,840 simply bought the repetition more room.
 *
 * Internal to the exam domain (imported by `generation.ts`); not re-exported
 * from the service root.
 */
export const OUTPUT_CAP_HEADROOM = 4;

/**
 * Attempts one chunk gets before the exam is declared lost.
 *
 * Four rather than three because an attempt no longer means "one request": a
 * truncated first request is retried inside `genSingle` at a wider cap, so a single
 * attempt can spend most of a slice. It also covers the top-up path, where an
 * attempt that returns two of five questions is progress rather than a failure and
 * consumes an attempt to bank it.
 *
 * The count is not what bounds the cost — the `modelMsLeft()` gate at the head of
 * the loop is, and it refuses an attempt that cannot finish. Raising this only
 * allows more tries within time that was already reserved.
 */
export const CHUNK_ATTEMPTS = 4;

/**
 * Longest one-shot attempt worth gambling on before chunking.
 *
 * Below the slice ceiling, because a one-shot that fails must still leave the
 * chunked path enough budget to succeed. This is the number that decides the
 * A-level Trigonometry case: ~78s estimated for the full exam is well past it,
 * so the doomed call is never made and the whole budget goes to chunks.
 */
const FULL_ATTEMPT_MAX_MS = 35_000;

/**
 * Structured-output throughput, used to size slices and to decide which strategy
 * can plausibly finish.
 *
 * Re-measured once reasoning was actually bounded. The old 90 came off round trips
 * running Gemini 3's *default dynamic* thinking, because `thinkingBudget: 0` was
 * being dropped on the wire (see `thinkingOptions`) — so it was measuring thinking
 * time, not generation. With `thinkingLevel: "low"` pinned, nine round trips in one
 * run came back at 116, 196, 198, 226, 250, 268, 298, 306 and 511 output tok/s.
 *
 * Set near the floor of that spread rather than its middle. This number divides
 * into every slice, so setting it above the typical rate under-sizes every slice
 * derived from it — and the 116 sample is real, not noise: a short response pays
 * the same fixed round-trip overhead over fewer tokens, so small calls always
 * measure slower.
 *
 * The cost of the old value was not a timeout but the opposite. It made
 * `msForTokens` claim a five-question chunk needed 28s when it reliably took 12–16s,
 * and `genSingle`'s retry gate believed it: `skipping retry: 21s of slice left,
 * needs ~28s` refused a retry that had nearly double the time it wanted.
 */
const PLANNING_TOKENS_PER_SECOND = 150;

/**
 * Waves of chunk calls held back for retries when deciding whether an exam fits.
 *
 * A plan that consumes the entire pool on its first pass is a plan with no answer
 * to one slow chunk, which is not a rare event: in the run this fixes, the only
 * chunk that succeeded did so on its *second* attempt, and there was no budget
 * left to give the other three the same chance. Reserving a wave is what turns
 * "fits if nothing goes wrong" into "fits".
 */
const RETRY_RESERVE_WAVES = 1;

/**
 * Reasoning control for a model call, which is model-generation specific.
 *
 * Gemini 3.x replaced the numeric `thinkingBudget` with `thinkingLevel`, and its
 * flash models cannot have reasoning switched off at all — `gemini-3.7-flash`
 * floors at `low`, and does not even accept `minimal`. This pipeline was sending
 * `thinkingBudget: 0` to exactly that model (see `BRIDGE_MODEL_TEXT`), so:
 *
 *  - the parameter is not part of 3.x and was dropped, leaving the model on its
 *    default *dynamic* thinking — it reasoned for as long as it judged necessary,
 *    which for `very_hard` A-level Trigonometry is a long time;
 *  - the old escalation ladder `[0, 1024]` was therefore two byte-identical
 *    requests, so a chunk that failed on transport paid a second full slice to
 *    fail the same way;
 *  - and `outputCapFor(0)` added nothing to the cap for tokens that reasoning
 *    spends out of it regardless.
 *
 * The fingerprint is in the logs: two chunk calls of the same shape in one run
 * came back at 93 and 30 output tok/s. Nothing generated three times slower — one
 * of them just spent most of its wall clock thinking, invisibly, because nothing
 * had bounded it.
 *
 * Pinning `low` bounds it. It cannot remove it, which is why
 * `estimateOutputTokens` is anchored on a total that includes reasoning.
 */
export function thinkingOptions(modelId: string): Record<string, JSONValue> {
  // Leading path segment tolerated (`models/gemini-3.7-flash`) because the SDK
  // accepts that form — its own generation patterns are anchored `(^|\/)gemini-`.
  // Anchoring at the string start instead would send a prefixed 3.x id down the
  // 2.5 branch, reintroducing this very bug through a config value.
  const major = Number.parseInt(/(?:^|\/)gemini-(\d+)/.exec(modelId)?.[1] ?? "0", 10);
  // 3.x and later: a level, floored at `low` because the flash models reject
  // `minimal` and none of them can be turned off.
  if (major >= 3) return { thinkingLevel: "low", includeThoughts: false };
  // 2.5: a numeric budget, which this generation does honour. Note that 2.5 *pro*
  // has a floor of 128 and rejects 0, so the Pro fallback needs a real budget if
  // `BRIDGE_MODEL_TEXT_PRO` is ever pointed back at a 2.5 model.
  return { thinkingBudget: 0, includeThoughts: false };
}

/**
 * How much a difficulty multiplies the per-question token cost.
 *
 * Harder questions carry longer stems, more setup and much longer worked
 * examples, and on a thinking model they also reason for longer before writing
 * anything. Difficulty was previously ignored entirely, which is part of why a
 * `very_hard` set blew through slices sized on a `medium` sample.
 */
const DIFFICULTY_TOKEN_FACTOR: Record<Difficulty, number> = {
  easy: 0.85,
  medium: 1,
  hard: 1.15,
  very_hard: 1.25,
};

/**
 * Output tokens one exam is expected to cost, reasoning included.
 *
 * Re-anchored on four clean chunks from one run rather than a single sample: five
 * A-level Trigonometry questions at `very_hard`, two question types, all three
 * extras, returning 2,592 / 2,891 / 3,187 / 3,715 output tokens — a mean of about
 * 619 per question. The previous figures worked out to 500, which is 20% under the
 * mean of the very shape they were calibrated on, and the shortfall lands directly
 * on `maxOutputTokens`: at the old 2.5× headroom a 500-token estimate bought a
 * 7,258-token cap, and two chunks in one run were cut off at 7,243 while their
 * siblings finished comfortably at 2,592 and 2,891.
 *
 * This is a mean, and deliberately only a mean. The same four calls span 2,592 to
 * 3,715 with two siblings above 7,243, so no single figure can be both the budget
 * projection and the safety margin. The projection is this; the margins are
 * `SLICE_HEADROOM` and `OUTPUT_CAP_HEADROOM`, and they are sized for the spread.
 *
 * `usage.outputTokens` counts reasoning as output, which is the right basis for
 * both things this number is used for: thinking is wall clock, and thinking tokens
 * count against `maxOutputTokens`. Thinking cannot be switched off on Gemini 3
 * flash models (see `thinkingOptions`), so an estimate that excluded it would be
 * wrong twice over.
 */
export function estimateOutputTokens(params: GenerateExamInput["params"]): number {
  let perQuestion = 150;
  if (params.includeHints) perQuestion += 60;
  if (params.includeExplanations) perQuestion += 110;
  // The single largest term, and by far the most variable: a `very_hard` maths
  // worked example is a multi-step LaTeX derivation with no natural length, which
  // is what made two chunks in the reference run cost triple their siblings.
  if (params.includeWorkedExamples) perQuestion += 160;
  // A mixed set costs more than a uniform one: format rules are restated per
  // question and the model drifts longer when it is switching between shapes.
  perQuestion *= 1 + 0.04 * Math.max(0, params.questionTypes.length - 1);
  perQuestion *= DIFFICULTY_TOKEN_FACTOR[params.difficulty];
  return Math.ceil(params.questionCount * perQuestion);
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Wall clock a call producing `outputTokens` is expected to need. */
export function msForTokens(outputTokens: number): number {
  return Math.round((outputTokens / PLANNING_TOKENS_PER_SECOND) * 1_000);
}

/** How long to *let* a call run, given what it's expected to need. */
function sliceFor(estMs: number): number {
  return clamp(Math.round(estMs * SLICE_HEADROOM), MIN_CALL_SLICE_MS, MAX_CALL_SLICE_MS);
}

/**
 * `maxOutputTokens` for one request, at a given headroom over its token estimate.
 *
 * Sized from the estimate rather than the old flat `12_000 + count * 2_500`, which
 * reached 62,000 for 20 questions — essentially the whole ceiling, so it stopped
 * nothing. But the multiplier then went too far the other way: at 2.5× a
 * five-question chunk got 7,258 tokens, and two chunks in one run were cut off at
 * 7,243 while their siblings finished at 2,592 and 2,891. Truncation is not a soft
 * failure — the JSON ends mid-token, nothing parses, and the whole round trip is
 * lost. See `OUTPUT_CAP_HEADROOM` for why generosity is nearly free.
 *
 * No separate thinking term. There used to be a `+ thinkingBudget`, which was `+ 0`
 * on the model actually in use and so reserved nothing for reasoning that happens
 * regardless; `estimateOutputTokens` is now anchored on a measured total that
 * already includes it.
 *
 * The flat `+ 2_000` is for the fixed part of a response that does not scale with
 * the question count — the title, the JSON scaffolding, and the first tokens of
 * reasoning — which at small counts is most of the payload. It is why a
 * single-question top-up gets a workable cap rather than a proportional sliver.
 */
export function outputCapFor(estOutputTokens: number, headroom: number): number {
  return Math.min(MODEL_MAX_OUTPUT_TOKENS, Math.ceil(estOutputTokens * headroom) + 2_000);
}

export type GenerationPlan = {
  /** Output tokens the whole exam is expected to cost. */
  estOutputTokens: number;
  /** Wall clock one all-in-one call is expected to need. */
  estFullMs: number;
  /** Whether that one-shot is worth attempting before chunking. */
  fullAttemptViable: boolean;
  /** Wall-clock ceiling for the one-shot call. */
  fullSliceMs: number;
  chunkSize: number;
  numChunks: number;
  /** Chunks in flight at once. */
  lanes: number;
  /** Sequential rounds of `lanes` chunks needed to cover the exam. */
  waves: number;
  /** Wall clock one chunk call is expected to need. */
  estChunkMs: number;
  /** Wall-clock ceiling for each chunk call. */
  chunkSliceMs: number;
  /**
   * `maxOutputTokens` a full chunk's first attempt gets, and what its retry gets
   * after a truncation.
   *
   * Reported because a cap is invisible until it bites: the run this fixes logged
   * its slices and its token estimate but not its cap, so two chunks stopping dead
   * at 7,243 tokens against a 7,258-token ceiling read as a mysterious "no output
   * generated" rather than as the arithmetic it was.
   */
  chunkOutputCap: number;
  /** Wall clock the chunked path is expected to need, start to finish. */
  projectedChunkedMs: number;
  /** Budget actually available to model calls, after the save reserve. */
  modelBudgetMs: number;
  /** By how much the chunked path overruns that; `0` means it fits. */
  overBudgetBy: number;
  /**
   * Whether *any* strategy here can deliver the exam. False means reject up
   * front: either the chunked run overruns the budget even before the retry
   * reserve, or `MAX_CHUNKS` forces a chunk so large that no slice we would grant
   * could finish it.
   */
  fits: boolean;
};

/**
 * Decide, before spending anything, which strategy can finish inside the budget.
 *
 * The 504 this replaces came from the pipeline having no such answer: it always
 * tried the one-shot first, handed it every millisecond of model time, and only
 * discovered the exam was too big for one call once that time was gone. The
 * arithmetic here is cheap, deterministic and pure — so the decision is made
 * once, up front, and is unit-testable without Firestore or a model.
 *
 * Pure and side-effect free by design: `budgetMs` is a parameter rather than a
 * read of the clock so the plan for a given set of params is reproducible.
 */
export function planGeneration(
  params: GenerateExamInput["params"],
  budgetMs: number = GENERATION_BUDGET_MS,
): GenerationPlan {
  const modelBudgetMs = budgetMs - SAVE_RESERVE_MS;
  const estOutputTokens = estimateOutputTokens(params);
  const estFullMs = msForTokens(estOutputTokens);

  // Grow the chunk rather than the chunk count, but only once `MAX_CHUNKS` runs
  // out: at 60 questions that ceiling is reached exactly at the preferred size,
  // so the largest supported exam is twelve five-question calls rather than
  // fewer, larger ones that a single request cannot finish.
  const chunkSize = Math.max(MIN_CHUNK_QUESTIONS, Math.ceil(params.questionCount / MAX_CHUNKS));
  const numChunks = Math.ceil(params.questionCount / chunkSize);
  const lanes = Math.min(CHUNK_CONCURRENCY, numChunks);
  const estChunkTokens = estimateOutputTokens({ ...params, questionCount: chunkSize });
  const estChunkMs = msForTokens(estChunkTokens);  // Lanes run concurrently, so cost is waves × the slowest chunk in a wave —
  // not the sum of every chunk. A trailing part-full wave costs a full wave.
  const waves = Math.ceil(numChunks / lanes);
  const projectedChunkedMs = waves * estChunkMs;
  const chunkSliceMs = sliceFor(estChunkMs);
  // Charged against the budget as if it were work, because a plan that only fits
  // when every chunk lands first time does not fit.
  const retryReserveMs = RETRY_RESERVE_WAVES * estChunkMs;
  const overBudgetBy = Math.max(0, projectedChunkedMs + retryReserveMs - modelBudgetMs);

  return {
    estOutputTokens,
    estFullMs,
    // Deliberately below the slice ceiling: a one-shot that fails must still
    // leave the chunked path enough budget to succeed.
    fullAttemptViable: estFullMs <= FULL_ATTEMPT_MAX_MS,
    fullSliceMs: sliceFor(estFullMs),
    chunkSize,
    numChunks,
    lanes,
    waves,
    estChunkMs,
    chunkSliceMs,
    chunkOutputCap: outputCapFor(estChunkTokens, OUTPUT_CAP_HEADROOM),
    projectedChunkedMs,
    modelBudgetMs,
    overBudgetBy,
    // `estChunkMs > chunkSliceMs` means `MAX_CALL_SLICE_MS` clamped the slice
    // below what the chunk needs — the chunk would abort every time, however
    // healthy the provider is. Since `MAX_CHUNKS` fixes the chunk size from
    // below, there is no smaller arrangement to fall back to: it simply doesn't
    // fit, and saying so costs nothing.
    fits: overBudgetBy === 0 && estChunkMs <= chunkSliceMs,
  };
}

/**
 * Largest question count that these settings can actually deliver.
 *
 * Searched rather than scaled, because the projection moves in steps: dropping a
 * question can remove a whole wave, or nothing at all. `planGeneration` is pure
 * arithmetic, so walking down from the requested count is cheaper than the
 * round trip it saves.
 */
export function largestViableQuestionCount(
  params: GenerateExamInput["params"],
  budgetMs: number = GENERATION_BUDGET_MS,
): number {
  for (let n = params.questionCount; n > MIN_CHUNK_QUESTIONS; n -= 1) {
    if (planGeneration({ ...params, questionCount: n }, budgetMs).fits) return n;
  }
  return MIN_CHUNK_QUESTIONS;
}

/**
 * Rejection for an exam that cannot be generated in one request, whatever we do.
 *
 * Names the levers the admin actually has — a count that does work, and the
 * extras costing the most per question — because "generation ran out of time"
 * after a 93s wait told them nothing about what to change.
 */
export function tooLargeError(
  params: GenerateExamInput["params"],
  plan: GenerationPlan,
): ExamsServiceError {
  const seconds = (ms: number) => Math.round(ms / 1_000);
  const extras = [
    params.includeWorkedExamples ? "worked examples" : null,
    params.includeExplanations ? "explanations" : null,
    params.includeHints ? "hints" : null,
  ].filter((x): x is string => x !== null);
  const levers = [`${largestViableQuestionCount(params)} questions or fewer`];
  if (extras.length) levers.push(`turning off ${extras.join(" or ")}`);
  // Two distinct causes, and claiming the wrong one would send the admin after
  // the wrong lever.
  const reason =
    plan.overBudgetBy > 0
      ? `needs about ${seconds(plan.projectedChunkedMs)}s of model time plus ` +
        `${seconds(plan.estChunkMs * RETRY_RESERVE_WAVES)}s held back for retries, and only ` +
        `${seconds(plan.modelBudgetMs)}s is available`
      : `splits into ${plan.numChunks} batches of ${plan.chunkSize}, and a batch that ` +
        `size takes longer than a single request can run`;
  return new ExamsServiceError(
    `This exam is too large to generate in one request: ${params.questionCount} questions ` +
      `with ${extras.length ? extras.join(", ") : "no extras"} ${reason}. ` +
      `Try ${levers.join(", or ")}.`,
    400,
  );
}
