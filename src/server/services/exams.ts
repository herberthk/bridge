import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";
import type { JSONValue, LanguageModelCallEndEvent } from "ai";

import { modelIds } from "@/server/ai/provider";
import {
  chunkDocumentText,
  examGenerationInstructions,
  examGenerationPrompt,
} from "@/server/ai/prompts";
import {
  attemptDoc,
  attemptsCol,
  examDoc,
  examsCol,
  usersCol,
} from "@/server/firebase/collections";
import { adminDb } from "@/server/firebase/admin";
import { writeAudit } from "@/server/services/audit";
import {
  assertCanAfford,
  consumeTokens,
  InsufficientTokensError,
} from "@/server/services/billing";
import { loadDocumentExcerpts } from "@/server/services/documents";
import type { SessionUser } from "@/server/auth/session";
import type {
  AttemptDoc,
  ExamDoc,
  ExamParams,
  WithId,
  WriteModel,
} from "@/types/firestore";
import type {
  AssignExamInput,
  ExamOutput,
  GenerateExamInput,
} from "@/lib/schemas/exam";
import { examOutputSchema } from "@/lib/schemas/exam";
import type { Difficulty } from "@/lib/constants";
import { mathifyCell, repairMath } from "@/lib/exam/latex";
import { isAssignGated, readReview, reviewProgress } from "@/lib/exam/review";
import { estimateGenerationTokens, reserveForGeneration } from "@/lib/pricing";
import type { Question } from "@/types/firestore";
import { vertex } from "@/lib/vertext";

export class ExamsServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

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
 * hints, explanations *and* worked examples. That is ~31,000 output tokens, and
 * at the 93 tok/s since measured off a real round trip it is ~350s of serial
 * model work — deliverable only by running chunks wide (see `CHUNK_CONCURRENCY`)
 * and only if there is wall clock to run them in. An 88s model pool could fit it
 * with 1.3s to spare, which is not a margin worth shipping.
 */
const GENERATION_BUDGET_MS = 150_000;

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
const MIN_CHUNK_QUESTIONS = 5;

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
const MAX_FULL_ATTEMPTS = 2;

/**
 * Held back from the budget so the Firestore write, the token deduction and the
 * audit entry still fit after the last model call returns.
 */
const SAVE_RESERVE_MS = 12_000;

/**
 * Retries *inside* one SDK call. The default of 2 means 3 HTTP round trips per
 * call, and `genSingle` makes up to two calls — so at the default that is 6 round
 * trips before the outer loop sees a single failure, which is how one attempt
 * consumed 116s of a 120s `maxDuration`. The outer loop already retries with
 * backoff and escalates to Pro, so the inner retry only needs to absorb a one-off
 * blip.
 */
const AI_CALL_RETRIES = 1;

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
const MIN_CALL_SLICE_MS = 15_000;

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
 */
const OUTPUT_CAP_HEADROOM = 4;

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
const CHUNK_ATTEMPTS = 4;

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

/** Largest JSON payload a single visual may occupy before it's dropped. */
const MAX_VISUAL_JSON_CHARS = 4_000;

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
 * 7,258-token cap, and two of those five chunks wanted more than 7,243.
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
function estimateOutputTokens(params: GenerateExamInput["params"]): number {
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
const msForTokens = (outputTokens: number) =>
  Math.round((outputTokens / PLANNING_TOKENS_PER_SECOND) * 1_000);

/** How long to *let* a call run, given what it's expected to need. */
const sliceFor = (estMs: number) =>
  clamp(Math.round(estMs * SLICE_HEADROOM), MIN_CALL_SLICE_MS, MAX_CALL_SLICE_MS);

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
export const outputCapFor = (estOutputTokens: number, headroom: number) =>
  Math.min(MODEL_MAX_OUTPUT_TOKENS, Math.ceil(estOutputTokens * headroom) + 2_000);

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
function tooLargeError(
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

/**
 * Per-HTTP-round-trip diagnostics, and the only place a truncation is visible.
 *
 * `maxRetries` means one `generateText` await can be several provider calls, so
 * an elapsed time measured around the await cannot tell "one slow generation"
 * from "a fast failure, a backoff, then a second call" — and those want opposite
 * fixes. This reports each call on its own, including the throughput figure
 * `PLANNING_TOKENS_PER_SECOND` is meant to approximate.
 *
 * It also *records* the finish reason, because the error does not carry it.
 * `generateText` with `Output.object` throws `NoOutputGeneratedError`, whose
 * constructor takes only `{ message, cause }` — unlike its sibling
 * `NoObjectGeneratedError`, which does expose `finishReason`. So a response cut off
 * at `maxOutputTokens` and a response that came back as unparseable prose arrive
 * as the same opaque `No output generated.`, and they want opposite responses: a
 * wider cap versus a different roll of the dice. This hook fires before the throw,
 * so what it saw is the one reliable signal available. `truncated()` is what
 * `genSingle` branches on.
 */
function roundTripProbe(label: string) {
  let lastFinishReason: string | null = null;
  return {
    onEnd: (event: LanguageModelCallEndEvent) => {
      lastFinishReason = event.finishReason;
      const p = event.performance;
      console.log(
        `[exams] ${label} round trip: ${event.finishReason} in ${p.responseTimeMs}ms, ` +
          `${event.usage.outputTokens ?? 0} out tokens ` +
          `(${Math.round(p.effectiveOutputTokensPerSecond)} tok/s), model ${event.modelId}`,
      );
    },
    /** The model was cut off at `maxOutputTokens` rather than choosing to stop. */
    truncated: () => lastFinishReason === "length",
  };
}

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

/** Shared wording for every way the pipeline can run out of wall clock. */
function outOfTimeError(done: number, total: number): ExamsServiceError {
  return new ExamsServiceError(
    `Generation ran out of time${done > 0 ? ` after ${done}/${total} questions` : ""}. ` +
      `Try again with a lower question count, or turn off hints, explanations and worked examples.`,
    504,
  );
}

/**
 * Reject a visual large enough to threaten the 1 MiB document ceiling once many
 * questions carry one. Losing a chart beats losing the exam.
 *
 * Measured *after* trimming. This used to run on the raw model output, before
 * `sanitizeVisual` clipped cells to 100 chars and capped rows at 12 and headers
 * at 8 — so a wordy but perfectly salvageable table was dropped for a bulk that
 * no longer existed by the time anything was written.
 */
function withinSizeCap(clean: Record<string, unknown>): Question["visual"] {
  try {
    if (JSON.stringify(clean).length > MAX_VISUAL_JSON_CHARS) return null;
  } catch {
    return null; // circular or otherwise unserializable — Firestore would reject it too
  }
  return clean as Question["visual"];
}

/**
 * Longest hint, explanation or worked example we will store.
 *
 * The AI contract deliberately leaves these unbounded (a bound there rejects the
 * whole chunk — see `examOutputSchema`), so the ceiling lives here, where going
 * over costs the tail of one field. Generous next to the ~80-word worked example
 * the prompt asks for: this is a backstop, not the spec.
 */
const MAX_PROSE_CHARS = 1_200;

/**
 * Find where a field stops saying something and starts repeating itself, or null
 * if it never does.
 *
 * Turning off constrained decoding made the repetition loop rare, not impossible,
 * and a loop that terminates on its own is the dangerous shape: it parses, it
 * validates, and it persists. One observed worked example ran to 14,740 characters
 * of `pi over 12, 5 pi over 12, and pi over 2 directly without extraneous roots in
 * range` repeated verbatim — which a student would have been shown.
 *
 * The test is deliberately hard to trip: half the field or more has to be
 * verbatim repeats of one 60-character window, which no real explanation does but
 * a collapse always does (its coverage runs 0.7–1.0). The index returned is the
 * *second* occurrence, so the caller keeps the part that was still saying
 * something — in that example, a correct derivation — and drops the rest.
 */
function repetitionCut(text: string): number | null {
  const WINDOW = 60;
  if (text.length < 400) return null;
  for (let i = 0; i + WINDOW <= text.length; i += WINDOW) {
    const probe = text.slice(i, i + WINDOW);
    const hits: number[] = [];
    for (let at = text.indexOf(probe); at !== -1; at = text.indexOf(probe, at + WINDOW)) {
      hits.push(at);
    }
    if (hits.length >= 3 && (hits.length * WINDOW) / text.length >= 0.5) return hits[1]!;
  }
  return null;
}

/**
 * Narrow an AI-supplied free-text field to something worth storing: dropped if
 * absent, cut where it starts looping, capped at `MAX_PROSE_CHARS`.
 */
export function clampProse(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (!text) return null;
  const cut = repetitionCut(text);
  if (cut !== null) text = text.slice(0, cut).trimEnd();
  if (text.length > MAX_PROSE_CHARS) text = `${text.slice(0, MAX_PROSE_CHARS).trimEnd()}…`;
  return text || null;
}

/**
 * `clampProse`, then LaTeX repair — in that order, because both cuts above land
 * at an arbitrary character and can fall inside a `$…$` span or a `\begin{cases}`
 * block. Repairing first and truncating second would reintroduce exactly the
 * unbalanced maths this is here to prevent.
 */
export function repairProse(value: unknown): string | null {
  const text = clampProse(value);
  return text === null ? null : repairMath(text) || null;
}

/**
 * Narrow an AI-supplied visual to something Firestore will accept and the
 * renderer can trust. Returns null whenever the payload isn't worth persisting.
 */
export function sanitizeVisual(v: unknown): Question["visual"] {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const isValidKey = (k: string) =>
    k.trim() !== "" &&
    !k.includes("/") &&
    !k.includes("*") &&
    !k.includes("[") &&
    !k.includes("]") &&
    !k.includes("~") &&
    !k.includes(".") &&
    !k.startsWith("__");
  if (obj.kind === "chart") {
    const chartType = obj.chartType as string;
    if (!["bar", "line", "pie", "area"].includes(chartType)) return null;
    const data = Array.isArray(obj.data) ? obj.data as Array<Record<string, unknown>> : [];
    const cleanData = data
      .slice(0, 12)
      .map((row) => {
        const out: Record<string, string | number> = {};
        for (const [k, val] of Object.entries(row as Record<string, unknown>)) {
          if (!isValidKey(k)) continue;
          if (typeof val === "string" && val.trim() !== "") out[k] = val.trim().slice(0, 80);
          else if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
          else if (val !== undefined && val !== null) {
            const s = String(val).trim();
            if (s) out[k] = s.slice(0, 80);
          }
        }
        return out;
      })
      .filter((r) => Object.keys(r).length >= 2);
    if (cleanData.length < 2) return null;
    const clean: Record<string, unknown> = { kind: "chart", chartType, data: cleanData };
    if (typeof obj.title === "string" && obj.title.trim()) clean.title = obj.title.trim().slice(0, 120);
    if (typeof obj.caption === "string" && obj.caption.trim()) clean.caption = obj.caption.trim().slice(0, 300);
    if (typeof obj.xKey === "string" && obj.xKey.trim() && isValidKey(obj.xKey.trim())) clean.xKey = obj.xKey.trim();
    if (typeof obj.yKey === "string" && obj.yKey.trim() && isValidKey(obj.yKey.trim())) clean.yKey = obj.yKey.trim();
    return withinSizeCap(clean);
  }
  if (obj.kind === "table") {
    // `mathifyCell` is applied *after* the length cap on purpose. A header such
    // as `\sum x^2` is notation the model wrote without delimiters, and the
    // renderer has no way to tell it apart from prose — so it reached students as
    // literal backslashes. Wrapping it here costs a few characters over the cap,
    // which is markup rather than content, and the whole visual is still measured
    // against `MAX_VISUAL_JSON_CHARS` below.
    const headers = Array.isArray(obj.headers)
      ? (obj.headers as unknown[])
          .filter((h): h is string => typeof h === "string" && h.trim() !== "")
          .slice(0, 8)
          .map((h) => mathifyCell(h.slice(0, 100)) || h.trim())
      : [];
    if (headers.length < 2) return null;
    // Each row is rewrapped as `{ cells }`: Firestore rejects an array whose
    // elements are arrays, and these rows sit inside the `questions` array.
    // Cells are coerced and padded to `headers.length` rather than filtered —
    // dropping one would shift every later column left and desync the row from
    // its headers. An already-wrapped row is accepted so this stays idempotent.
    const rows = (Array.isArray(obj.rows) ? (obj.rows as unknown[]) : [])
      .slice(0, 12)
      .map((r) => {
        const raw = Array.isArray(r)
          ? (r as unknown[])
          : Array.isArray((r as { cells?: unknown } | null)?.cells)
            ? (r as { cells: unknown[] }).cells
            : null;
        if (!raw) return null;
        const cells = Array.from({ length: headers.length }, (_, i) => {
          const cell = raw[i];
          if (cell === undefined || cell === null) return "";
          const text = String(cell).trim().slice(0, 100);
          return mathifyCell(text) || text;
        });
        return cells.some((c) => c !== "") ? { cells } : null;
      })
      .filter((r): r is { cells: string[] } => r !== null);
    if (rows.length === 0) return null;
    const clean: Record<string, unknown> = { kind: "table", headers, rows };
    if (typeof obj.title === "string" && obj.title.trim()) clean.title = obj.title.trim().slice(0, 120);
    if (typeof obj.caption === "string" && obj.caption.trim()) clean.caption = obj.caption.trim().slice(0, 300);
    return withinSizeCap(clean);
  }
  return null;
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

/**
 * Generate an exam with Gemini, metered against the caller's wallet.
 *
 * `warnings` carries non-fatal degradations the admin should see — a stripped
 * visual, an unbilled generation — for anything that happened *after* the exam
 * was durably saved and so must not be reported as a failure.
 */
export async function generateExam(
  actor: SessionUser,
  input: GenerateExamInput,
): Promise<{ exam: WithId<ExamDoc>; tokensUsed: number; warnings: string[] }> {
  const walletId = actor.schoolId ?? actor.uid;
  const estimate = estimateGenerationTokens(
    input.params.questionCount,
    input.documentIds.length > 0,
  );
  await assertCanAfford(walletId, reserveForGeneration(estimate));

  // Decided before a token is spent or a document is read. This exact shape —
  // 20 questions with hints, explanations and worked examples — used to burn the
  // whole 93s on a one-shot that could never fit, then return a 504 having
  // produced nothing; anything genuinely too large now fails in milliseconds
  // with the levers named.
  const plan = planGeneration(input.params);
  if (!plan.fits) {
    console.warn(
      `[exams] rejecting oversized generation: ${input.params.questionCount} q ` +
        `→ ${plan.numChunks} chunks of ${plan.chunkSize} in ${plan.waves} wave(s), ` +
        `≈${Math.round(plan.projectedChunkedMs / 1_000)}s against a ` +
        `${Math.round(plan.modelBudgetMs / 1_000)}s model budget`,
    );
    throw tooLargeError(input.params, plan);
  }
  console.log(
    `[exams] plan: ~${plan.estOutputTokens} out tokens; one-shot ` +
      `${plan.fullAttemptViable
        ? `~${Math.round(plan.estFullMs / 1_000)}s, ${Math.round(plan.fullSliceMs / 1_000)}s slice`
        : `skipped (~${Math.round(plan.estFullMs / 1_000)}s > ${FULL_ATTEMPT_MAX_MS / 1_000}s)`}; ` +
      `chunked ${plan.numChunks}×${plan.chunkSize} in ${plan.waves} wave(s) of ${plan.lanes}, ` +
      `≈${Math.round(plan.projectedChunkedMs / 1_000)}s, ` +
      `${Math.round(plan.chunkSliceMs / 1_000)}s slice each, ` +
      // The cap belongs in the plan line because it is the one limit whose failure
      // mode is silent: a chunk stopping dead at its ceiling surfaces only as "no
      // output generated", so without this the arithmetic has to be reconstructed.
      `${plan.chunkOutputCap} token cap`,
  );

  const deadline = Date.now() + GENERATION_BUDGET_MS;
  const msLeft = () => deadline - Date.now();
  /**
   * Budget a model call may actually use — what's left, less the reserve the save
   * path needs. Every gate below is expressed in this, so no gate can admit a
   * call that would eat the Firestore write.
   */
  const modelMsLeft = () => msLeft() - SAVE_RESERVE_MS;
  const warnings: string[] = [];

  const excerpts = input.documentIds.length
    ? await loadDocumentExcerpts(actor, input.documentIds)
    : [];

  let output: ExamOutput | null = null;
  let tokensUsed = 0;
  let inputTokensUsed = 0;
  let outputTokensUsed = 0;
  let lastFailure: ExamsServiceError | null = null;

  const recordBillingFailure = async (
    targetId: string | null,
    error: unknown,
  ) => {
    const reason = error instanceof Error ? error.message : String(error);
    await writeAudit({
      actorId: actor.uid,
      actorRole: actor.role,
      action: "exam.billing_failed",
      targetType: "exam",
      targetId,
      meta: { walletId, tokensUsed, reason },
    });
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms: number) => ms + Math.floor(Math.random() * 400);

  /**
   * Caps a single model call at the smaller of what's left of its slice and what
   * remains of the budget.
   *
   * `msLeft()` alone only gates *between* attempts — it cannot stop a call already
   * in flight, which is how one attempt ran 116s against a 120s `maxDuration`.
   * The slice stops the opposite failure: a call that is merely slow rather than
   * broken used to be handed the entire pool, and spent it.
   *
   * Takes a deadline rather than a duration, because the slice belongs to the
   * `genSingle` call as a whole and not to each request inside it. Passing the
   * duration meant the fallback started its own fresh slice, so one chunk could
   * spend 2× what the planner costed it at — which makes the wave arithmetic in
   * `planGeneration` describe a run that cannot happen.
   */
  const callSignal = (deadlineAt: number) =>
    AbortSignal.timeout(Math.max(5_000, Math.min(deadlineAt - Date.now(), modelMsLeft())));

  // Helper: single Gemini call for exactly `count` questions.
  // Structured output plus thinking can return AI_NoOutputGeneratedError, which is
  // what the untuned fallback below recovers from.
  async function genSingle(
    params: GenerateExamInput["params"],
    docExcerpts: typeof excerpts,
    /** Log label only — carries no control flow. */
    attemptLabel: string,
    opts: {
      /** Wall-clock ceiling for every model call this makes. */
      sliceMs: number;
      useProFallback?: boolean;
    },
  ): Promise<{ out: ExamOutput; tokens: number; inputTokens: number; outputTokens: number }> {
    const modelId = opts.useProFallback ? modelIds.textPro() : modelIds.text();
    const model = vertex(modelId);
    const estOutput = estimateOutputTokens(params);
    const prompt = examGenerationPrompt(
      params,
      docExcerpts.map((d) => ({ name: d.name, text: chunkDocumentText(d.text) })),
    );
    const instructions = examGenerationInstructions(params);
    const thinking = thinkingOptions(modelId);
    /**
     * `structuredOutputs: false` is the fix for the 504, and it is not a loosening
     * of validation.
     *
     * The provider's default is to convert the zod schema to an OpenAPI schema and
     * send it as `responseSchema`, which makes Gemini decode under a grammar. On
     * `gemini-3.7-flash` that grammar sends the model into a degenerate repetition
     * loop on long free-form fields: it restates one clause verbatim until it hits
     * `maxOutputTokens`, so the JSON is never closed and the whole chunk is lost.
     * The reference run shows all four chunks failing that way at 563–801 tok/s —
     * fast *content* emission, not slow reasoning.
     *
     * Measured over six round trips per arm, on the request that produced the 504
     * (A-level `very_hard` Trigonometry, five questions, hints + explanations +
     * worked examples, 14,480 cap, temperature 0.35, `thinkingLevel: "low"`):
     *
     *   responseSchema on  — 1/6 usable; the other five stopped at 14,465–14,466
     *                        output tokens with `finishReason: "length"`
     *   responseSchema off — 6/6 parsed and validated, at 2,416–2,894 output
     *                        tokens in 7–29s
     *
     * What was ruled out first, so none of it gets retried: temperature 0.9 (looped
     * 3/3, so this is not low-temperature sampling collapse); `thinkingLevel`
     * "medium" (1/3 lost) and "high" (3/3 lost — reasoning makes it worse, not
     * better); `maxLength` on the long string fields (the API accepts the key and
     * ignores it — 2,095 characters came back against a 700 limit, and the provider
     * drops the keyword in conversion anyway); and `frequencyPenalty` /
     * `presencePenalty`, which this model rejects outright with HTTP 400 "Penalty is
     * not enabled for this model".
     *
     * `responseMimeType: "application/json"` is still sent, and `Output.object`
     * still parses the response and validates it against `examOutputSchema` on this
     * side — the schema simply stops being a decoding constraint. What that does
     * cost is the model's only description of the envelope, so the field list now
     * has to be stated in the prompt; see the "Output format" block in
     * `examGenerationInstructions`.
     */
    const googleOptions = { thinkingConfig: thinking, structuredOutputs: false };
    // One slice for the whole helper, shared by both requests below.
    const sliceDeadline = Date.now() + opts.sliceMs;

    let lastErr: unknown = null;
    // One shaped call, not a ladder. The old loop escalated a thinking budget the
    // model in use does not accept, so its second rung re-issued an identical
    // request — a full slice spent to reach the same outcome.
    const startedAt = Date.now();
    // Wall clock the first attempt actually spent. Needed after a truncation,
    // where it is the floor on what the widened retry will need.
    let shapedElapsedMs = 0;
    const shapedCap = outputCapFor(estOutput, OUTPUT_CAP_HEADROOM);
    const shapedProbe = roundTripProbe(`${attemptLabel} shaped`);
    try {
      const result = await generateText({
        model,
        output: Output.object({ schema: examOutputSchema }),
        instructions,
        prompt,
        temperature: 0.35,
        maxOutputTokens: shapedCap,
        maxRetries: AI_CALL_RETRIES,
        abortSignal: callSignal(sliceDeadline),
        onLanguageModelCallEnd: shapedProbe.onEnd,
        providerOptions: { google: googleOptions, googleVertex: googleOptions },
      });
      const usage = (result as unknown as { usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } }).usage;
      const { tokens, inputTokens, outputTokens } = readUsage(usage);
      const out = result.output as ExamOutput;
      console.log(
        `[exams] gen ${attemptLabel}: ` +
          `${out.questions.length}/${params.questionCount} q, ${tokens} tokens ` +
          `(out ${outputTokens}/${shapedCap} cap) in ${Date.now() - startedAt}ms`,
      );
      return { out, tokens, inputTokens, outputTokens };
    } catch (err) {
      lastErr = err;
      shapedElapsedMs = Date.now() - startedAt;
      console.warn(
        `[exams] gen ${attemptLabel} shaped generateText failed after ${shapedElapsedMs}ms:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // Out of budget: the fallback would only abort too, and its own failure
    // would mask the timeout with a confusing "no output" message.
    if (isAbortError(lastErr)) throw lastErr;

    /**
     * Was the first attempt cut off at its cap, or did it genuinely fail?
     *
     * The distinction has to come from the probe because the thrown error cannot
     * carry it — see `roundTripProbe`. It decides both numbers below, and they
     * differ in opposite directions, so getting it from the message text (which is
     * just `No output generated.` either way) would be worse than not asking.
     */
    const wasTruncated = shapedProbe.truncated();
    /**
     * The retry only runs if the rest of the slice can actually hold it.
     *
     * A call given less time than the estimate aborts by construction, and the
     * abort then replaces the parse failure that really happened with a timeout —
     * so the logs blame the clock for a bad payload. Better to surface the real
     * error while it is still the real error.
     *
     * A truncation used to cost extra here, floored at whatever the first attempt
     * spent, because the widened retry was being asked to produce *more* than the
     * call that had just run out of room. It is not asked that any more (see below),
     * and keeping the floor actively hurt: a looped attempt burns its whole slice
     * reaching the cap, so flooring at ~25s refused re-rolls that only needed ~12s.
     */
    const sliceLeftMs = sliceDeadline - Date.now();
    const needMs = msForTokens(estOutput);
    if (sliceLeftMs < needMs) {
      console.warn(
        `[exams] gen ${attemptLabel} skipping retry: ${Math.round(sliceLeftMs / 1000)}s of slice ` +
          `left, needs ~${Math.round(needMs / 1000)}s`,
      );
      throw lastErr ?? new Error("AI_NoOutputGeneratedError: generateText returned empty output");
    }

    // The thinking config is repeated rather than dropped: leaving it off does not
    // mean "no thinking" on Gemini 3, it means *dynamic* thinking, so the retry
    // would be slower than the attempt it is recovering from — the opposite of
    // what a fallback is for.
    console.warn(
      `[exams] gen ${attemptLabel} retrying shaped call at the same ${shapedCap} token cap: ` +
        (wasTruncated
          ? "previous attempt reached the cap without closing its JSON, re-rolling warmer"
          : "warmer temperature"),
    );
    const fallbackStartedAt = Date.now();
    const retryProbe = roundTripProbe(`${attemptLabel} retry`);
    const result = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: examOutputSchema }),
      maxOutputTokens: shapedCap,
      // Nudged off the first attempt's setting so a re-roll is a genuinely
      // different request rather than a byte-identical one. A truncation now gets
      // the same warmer sample as any other failure: reaching the cap means the
      // model repeated itself into it, and re-issuing at 0.35 would re-run the
      // sample that did that.
      temperature: 0.5,
      maxRetries: AI_CALL_RETRIES,
      abortSignal: callSignal(sliceDeadline),
      onLanguageModelCallEnd: retryProbe.onEnd,
      providerOptions: { google: googleOptions, googleVertex: googleOptions },
    });
    if (!result.output) {
      console.error(`[exams] generateText returned no output`, {
        attemptLabel,
        elapsedMs: Date.now() - fallbackStartedAt,
        // Both, because they answer different questions. The result's reason
        // describes the await as a whole; the probe's describes the last provider
        // call inside it, which is the one that actually ran out of room.
        finishReason: (result as unknown as { finishReason?: unknown }).finishReason,
        lastCallTruncated: retryProbe.truncated(),
        maxOutputTokens: shapedCap,
        usage: result.usage,
        textSnippet: typeof result.text === "string" ? result.text.slice(0, 2000) : undefined,
        lastErr: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      throw lastErr ?? new Error("AI_NoOutputGeneratedError: generateText returned empty output");
    }
    const usage = result.usage;
    const { tokens, inputTokens, outputTokens } = readUsage(usage);
    const out = result.output as ExamOutput;
    console.log(
      `[exams] gen ${attemptLabel} (generateText retry): ` +
        `${out.questions.length}/${params.questionCount} q, ${tokens} tokens ` +
        `(out ${outputTokens}/${shapedCap} cap) in ${Date.now() - fallbackStartedAt}ms`,
    );
    return { out, tokens, inputTokens, outputTokens };
  }

  // Phase 1: try the whole exam in one call. Transient truncation often clears on
  // a second try, so retry once before paying the round-trip cost of chunking.
  //
  // Skipped outright when the plan says one call can't finish. The one-shot used
  // to be attempted unconditionally, which meant the *least* likely strategy spent
  // the budget first: 20 questions with hints, explanations and worked examples is
  // ~7,000 output tokens, and at the throughput we've measured that cannot land in
  // one call no matter how many times it's retried. Four five-question chunks can.
  if (!plan.fullAttemptViable) {
    console.warn(
      `[exams] skipping full-exam attempts: ~${Math.round(plan.estFullMs / 1_000)}s of ` +
        `generation estimated for ${input.params.questionCount} questions, ceiling is ` +
        `${FULL_ATTEMPT_MAX_MS / 1_000}s — going straight to chunked`,
    );
  }
  for (let attempt = 1; plan.fullAttemptViable && attempt <= MAX_FULL_ATTEMPTS && !output; attempt += 1) {
    // A one-shot is only worth gambling on while losing it still leaves the
    // chunked path enough model time to finish. The old flat 25s floor let a
    // doomed attempt eat exactly the runway the fallback needed.
    if (modelMsLeft() < plan.fullSliceMs + plan.projectedChunkedMs) {
      console.warn(
        `[exams] skipping full attempt ${attempt}: ${modelMsLeft()}ms of model time left, ` +
          `need ${plan.fullSliceMs + plan.projectedChunkedMs}ms to risk it — chunking instead`,
      );
      break;
    }
    try {
      const { out: candidate, tokens, inputTokens, outputTokens } = await genSingle(
        input.params,
        excerpts,
        `full ${attempt}/${MAX_FULL_ATTEMPTS}`,
        { sliceMs: plan.fullSliceMs },
      );
      tokensUsed += tokens;
      inputTokensUsed += inputTokens;
      outputTokensUsed += outputTokens;
      const count = candidate.questions.length;
      const drift = Math.abs(count - input.params.questionCount);
      if (count !== input.params.questionCount && drift > Math.max(2, input.params.questionCount * 0.2)) {
        // For severe truncation (e.g. 1 vs 20) immediately fall through to chunked
        // after recording failure — don't waste remaining full retries on same shape.
        const severe = count < Math.ceil(input.params.questionCount * 0.5);
        throw new ExamsServiceError(
          `AI returned ${count} questions (expected ${input.params.questionCount}).${severe ? " Severe truncation — will retry chunked." : ""}`,
          502,
        );
      }
      output = candidate;
    } catch (err) {
      console.error(`[exams] generation attempt ${attempt}/${MAX_FULL_ATTEMPTS} failed`, err);
      if (isAbortError(err)) {
        // The call overran *its slice*, which is no longer the same as overrunning
        // the budget. Throwing here is what turned one slow one-shot into a 504
        // with nothing attempted; fall through to chunking whenever enough model
        // time survives to fund a chunk, and only give up when it doesn't.
        if (modelMsLeft() < MIN_CALL_SLICE_MS) {
          throw outOfTimeError(0, input.params.questionCount);
        }
        console.warn(
          `[exams] full attempt ${attempt} hit its ${Math.round(plan.fullSliceMs / 1_000)}s slice; ` +
            `${modelMsLeft()}ms of model time left — switching to chunked`,
        );
        lastFailure = outOfTimeError(0, input.params.questionCount);
        break;
      }
      lastFailure =
        err instanceof ExamsServiceError
          ? err
          : new ExamsServiceError(
              `AI generation failed: ${err instanceof Error ? err.message : "Unknown AI error"}`,
              502,
            );
      // If severe truncation, break early to chunked fallback.
      if (lastFailure.message.includes("Severe truncation")) break;
      // Backoff before next full attempt on transient 503/429/no-output errors
      if (attempt < MAX_FULL_ATTEMPTS && isRetryableAiError(err)) {
        await sleep(jitter(1200 * attempt));
      }
    }
  }

  // Phase 2: chunked fallback — split the exam into smaller requests. This avoids
  // the single huge JSON array that triggers reasoning truncation. Each chunk
  // retries with exponential backoff and escalates to the Pro model on overload.
  if (!output) {
    const total = input.params.questionCount;
    const { chunkSize, numChunks, lanes } = plan;
    console.warn(
      `[exams] falling back to chunked generation (${total} → ${numChunks} chunks of ` +
        `${chunkSize}, ${lanes} at a time, ${modelMsLeft()}ms of model time left)`,
    );

    // Staging holds *wire* questions, not `Question`s: ids and the storage-side
    // visual shape are both assigned once, in the mapping below, after every
    // chunk has landed. Numbering them here only to strip the ids again a few
    // lines later was churn that also hid the wire/storage type mismatch.
    //
    // Indexed rather than appended, because lanes finish out of order and
    // question order is what the student sees.
    const staged: (ExamOutput | null)[] = new Array(numChunks).fill(null);
    let chunkTitle: string | null = null;
    let chunkTokens = 0;
    let chunkInputTokens = 0;
    let chunkOutputTokens = 0;
    let done = 0;

    /** Generate one chunk, retrying it in place. Throws once the chunk is lost. */
    async function runChunk(idx: number): Promise<void> {
      const chunkIndex = idx + 1;
      const offset = idx * chunkSize;
      const need = Math.min(chunkSize, total - offset);

      /**
       * Questions this chunk has banked so far, across attempts.
       *
       * The bug this fixes: a chunk that came back short threw, and one thrown
       * chunk fails the whole exam. In the reference run chunk 4 returned 2 of 5
       * questions on its last attempt and the request 502'd — discarding 22
       * questions from four chunks that had already succeeded and been paid for.
       * A short return is partial progress, so it is kept and the next attempt is
       * asked only for the difference.
       */
      const banked: ExamOutput["questions"] = [];
      let lastChunkErr: ExamsServiceError | null = null;

      for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt += 1) {
        const shortfall = need - banked.length;
        const chunkParams: GenerateExamInput["params"] = {
          ...input.params,
          questionCount: shortfall,
          // The "avoid repeating" hint is keyed on whether anything else exists to
          // repeat, not on the chunk's position: a top-up for chunk 1 has its own
          // banked questions to avoid, and asking for 3 more without saying so is
          // how a top-up returns near-duplicates of what it is topping up.
          topic:
            chunkIndex === 1 && banked.length === 0
              ? input.params.topic
              : `${input.params.topic} — part ${chunkIndex}${banked.length ? ` continued` : ""} ` +
                `(avoid repeating earlier questions)`,
        };
        /**
         * Gated on what *this* request needs, not on a full chunk.
         *
         * `MIN_CALL_SLICE_MS` (15s) let a chunk start with far less time than its
         * own estimate — and because `callSignal` clamps the slice to whatever is
         * left, that retry aborted by construction. In the run this fixes, three
         * lanes each burned a third attempt that way: 31.1s → 31.1s → 25.1s, every
         * one of them doomed before the request left the process. Three lanes ×
         * three unwinnable attempts is how 88s produced 5 of 20 questions.
         *
         * Costed from `shortfall` so a top-up is judged on the two questions it is
         * actually asking for. Gating a 2-question top-up on a 5-question estimate
         * would refuse the cheap call that completes the exam.
         */
        const attemptNeedMs = msForTokens(estimateOutputTokens(chunkParams));
        if (modelMsLeft() < attemptNeedMs) {
          throw outOfTimeError(done * chunkSize + banked.length, total);
        }
        try {
          // Last attempt escalates the model. `>=` rather than `===` so raising
          // `CHUNK_ATTEMPTS` cannot silently strand the escalation mid-loop.
          const useProFallback = attempt >= CHUNK_ATTEMPTS;
          const { out, tokens, inputTokens, outputTokens } = await genSingle(
            chunkParams,
            excerpts,
            `chunk ${chunkIndex}/${numChunks} attempt ${attempt}`,
            { useProFallback, sliceMs: plan.chunkSliceMs },
          );
          // Only reached after every `await`, so these accumulate safely — the
          // lanes interleave but never actually run at the same instant.
          //
          // Counted here rather than on chunk completion because they are billed
          // here: a short attempt whose questions get banked is spend the exam
          // record should reflect, and the old placement dropped it.
          chunkTokens += tokens;
          chunkInputTokens += inputTokens;
          chunkOutputTokens += outputTokens;
          chunkTitle ??= out.title;
          // Trimmed to the shortfall: an over-delivering call is otherwise how a
          // chunk contributes six questions to a five-question slot and the exam
          // ends up longer than the admin asked for.
          banked.push(...out.questions.slice(0, shortfall));

          if (banked.length < need) {
            lastChunkErr = new ExamsServiceError(
              `Chunk ${chunkIndex} returned ${banked.length}/${need} questions.`,
              502,
            );
            console.warn(
              `[exams] chunk ${chunkIndex}/${numChunks} short after attempt ${attempt}: ` +
                `${banked.length}/${need} q — topping up ${need - banked.length} more`,
            );
            continue;
          }

          staged[idx] = { title: out.title, questions: banked };
          done += 1;
          console.log(
            `[exams] chunk ${chunkIndex}/${numChunks} succeeded: ${need} q in ${attempt} ` +
              `attempt(s) (${done}/${numChunks} done, ${modelMsLeft()}ms of model time left)`,
          );
          return;
        } catch (err) {
          console.error(`[exams] chunk ${chunkIndex} attempt ${attempt} failed`, err);
          if (isAbortError(err)) {
            // A chunk aborts on its own slice, not on the whole budget, so an abort
            // no longer proves the exam is unsalvageable — a slow provider response
            // can still be worth one more try. The loop head's budget gate is what
            // keeps that from being a retry with less time than the work needs.
            lastChunkErr = outOfTimeError(done * chunkSize + banked.length, total);
            continue;
          }
          lastChunkErr =
            err instanceof ExamsServiceError
              ? err
              : new ExamsServiceError(
                  `Chunk ${chunkIndex} failed: ${err instanceof Error ? err.message : "Unknown"}`,
                  502,
                );
          if (attempt < CHUNK_ATTEMPTS) {
            // Exponential backoff with jitter: 1.2s, 2.4s — longer if 503/high-demand
            const base = isRetryableAiError(err) ? 1500 * attempt : 800 * attempt;
            await sleep(jitter(base));
          }
        }
      }

      throw lastChunkErr ??
        new ExamsServiceError(`Failed to generate chunk ${chunkIndex}.`, 502);
    }

    // A bounded pool rather than `Promise.all` over every chunk: the whole point
    // of chunking is to stop overloading the model, and sequential was worse —
    // 8 chunks × the 15s floor is 120s, so above ~10 questions the fallback
    // could never finish inside the budget it was supposed to respect.
    let nextIdx = 0;
    let poolErr: unknown = null;
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (poolErr === null) {
          const idx = nextIdx;
          if (idx >= numChunks) return;
          nextIdx += 1;
          try {
            await runChunk(idx);
          } catch (err) {
            // One lost chunk means an incomplete exam, so the surviving lanes
            // stop picking up new work rather than spend the rest of the budget
            // on questions we're about to discard. Whatever is already in flight
            // still settles — there's no way to unsend it.
            poolErr ??= err;
            return;
          }
        }
      }),
    );
    tokensUsed += chunkTokens;
    inputTokensUsed += chunkInputTokens;
    outputTokensUsed += chunkOutputTokens;
    if (poolErr !== null) {
      // Successful chunk calls have already spent provider tokens even though
      // the incomplete exam cannot be saved. Keep their totals and record the
      // unrecoverable, unbilled spend before propagating the original failure.
      if (tokensUsed > 0) await recordBillingFailure(null, poolErr);
      throw poolErr;
    }

    lastFailure = null; // every chunk landed
    output = {
      title: chunkTitle ?? `Exam: ${input.params.topic}`,
      questions: staged.flatMap((c) => c?.questions ?? []),
    };
    console.log(
      `[exams] chunked generation succeeded: ${output.questions.length}/${total} q, ` +
        `+${chunkTokens} tokens, ${modelMsLeft()}ms of model time left`,
    );
  }

  if (!output) {
    throw lastFailure ?? new ExamsServiceError("AI returned an empty exam. Try again.", 502);
  }

  const questions: Question[] = output.questions.map((q, i) => ({
    id: `q${i + 1}`,
    type: q.type,
    prompt: repairMath(q.prompt),
    options: q.options ? q.options.map(repairMath) : null,
    correctOptionIndex: q.correctOptionIndex ?? null,
    correctBool: q.correctBool ?? null,
    // Deliberately *not* repaired. These are compared against typed answers via
    // `normalizeAnswer`, so wrapping `9/5` as `$\frac{9}{5}$` would stop a correct
    // answer from scoring.
    acceptableAnswers: q.acceptableAnswers ?? null,
    pairs: q.pairs
      ? q.pairs
          .map((p) => ({ left: repairMath(p.left ?? ""), right: repairMath(p.right ?? "") }))
          .filter((p) => p.left && p.right)
      : null,
    points: typeof q.points === "number" && Number.isFinite(q.points) ? q.points : 1,
    hint: repairProse(q.hint),
    explanation: repairProse(q.explanation),
    workedExample: repairProse(q.workedExample),
    visual: sanitizeVisual(q.visual),
  }));

  const now = FieldValue.serverTimestamp();
  const params: ExamParams = {
    ...input.params,
    subject: input.params.subject as ExamParams["subject"],
  };
  const doc: WriteModel<ExamDoc> = {
    title: output.title,
    params,
    questions,
    sourceType: excerpts.length ? "documents" : "params",
    sourceDocumentIds: input.documentIds,
    status: "draft",
    createdBy: actor.uid,
    schoolId: actor.schoolId,
    usage: {
      generationInputTokens: inputTokensUsed,
      generationOutputTokens: outputTokensUsed,
      gradingTokens: 0,
      revisionTokens: 0,
    },
    // Written at creation so the review screen and the assign gate read a real
    // object on every new exam, and only exams that predate this feature take the
    // `readReview` fallback path.
    review: {
      approvedIds: [],
      revisedCount: 0,
      approvedAt: null,
      approvedBy: null,
      overriddenAt: null,
      updatedAt: null,
    },
    createdAt: now,
    updatedAt: now,
  };
  const examsRef = examsCol();
  // The converter types `add` as taking an `ExamDoc`, but a create carries
  // `serverTimestamp()` sentinels in the timestamp fields — hence `WriteModel`
  // and this one cast, kept in a single place rather than at each call site.
  const asExamDoc = (d: WriteModel<ExamDoc>) => d as unknown as ExamDoc;

  let ref: Awaited<ReturnType<typeof examsRef.add>>;
  let savedDoc: WriteModel<ExamDoc> = doc;
  try {
    ref = await examsRef.add(asExamDoc(doc));
  } catch (err) {
    console.error("[exams] Firestore add failed", err, {
      title: output.title,
      questions: output.questions.length,
      params: input.params,
      sampleVisual: questions.find((q) => q.visual)?.visual,
    });
    // Visuals are the only optional payload, so they're the only thing worth
    // dropping to rescue an otherwise-complete exam: an oversized document, or
    // a nested-entity rejection from a shape `sanitizeVisual` failed to flatten.
    const msg = err instanceof Error ? err.message : String(err);
    const recoverable = /larger than|too large|1,048,876|1048576|invalid nested entity/i.test(msg);
    const hasVisuals = questions.some((q) => q.visual);
    if (!recoverable || !hasVisuals) {
      throw new ExamsServiceError(`Failed to save exam: ${msg}`, 500);
    }
    console.warn("[exams] retrying without visuals due to:", msg);
    const strippedDoc: WriteModel<ExamDoc> = {
      ...doc,
      questions: questions.map((q) => ({ ...q, visual: null })),
    };
    try {
      ref = await examsRef.add(asExamDoc(strippedDoc));
      savedDoc = strippedDoc;
      console.log("[exams] saved stripped doc without visuals", ref.id);
      warnings.push(
        "Charts and tables could not be saved with this exam, so they were removed. The questions themselves are intact.",
      );
    } catch (retryErr) {
      console.error("[exams] stripped retry also failed", retryErr);
      throw new ExamsServiceError(
        `Failed to save exam: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        500,
      );
    }
  }

  try {
    await consumeTokens({
      walletId,
      tokens: tokensUsed,
      category: "text_generation",
      description: `Generated “${output.title}”`,
      refType: "exam",
      refId: ref.id,
      actorId: actor.uid,
    });
  } catch (err) {
    console.error("[exams] billing failed for exam", ref.id, err, { walletId, tokensUsed });
    await recordBillingFailure(ref.id, err);
    if (err instanceof InsufficientTokensError) {
      // A concurrent charge may consume the preflight balance before the final
      // deduction. Do not expose a successfully generated, unpaid draft in that
      // case; reject the request and roll back the document best-effort.
      await ref.delete().catch((deleteErr) => {
        console.error("[exams] failed to remove unbilled exam", ref.id, deleteErr);
      });
      throw err;
    }
    // Other billing failures may be transient. The exam is already durable, so
    // return it with a reconciliation warning instead of encouraging a costly
    // regeneration.
    warnings.push(
      `The exam was saved but ${tokensUsed.toLocaleString()} tokens could not be deducted from the wallet. Your balance may be adjusted later.`,
    );
  }

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "exam.generated",
    targetType: "exam",
    targetId: ref.id,
    meta: { tokensUsed, model: modelIds.text(), subject: params.subject },
  });

  return {
    // `savedDoc` rather than `doc`: on the stripped retry those differ, and
    // returning `doc` would show the caller visuals that were never persisted.
    // Timestamps are still unresolved sentinels — the caller re-reads for those.
    exam: {
      id: ref.id,
      ...(savedDoc as ExamDoc),
      createdAt: null as unknown as ExamDoc["createdAt"],
    },
    tokensUsed,
    warnings,
  };
}

/** Assign an exam to students → creates pending attempts (optionally scheduled). */
export async function assignExam(
  actor: SessionUser,
  input: AssignExamInput,
): Promise<number> {
  if (actor.role !== "admin" && actor.role !== "super_admin") {
    throw new ExamsServiceError("Not allowed.", 403);
  }
  const examSnap = await examDoc(input.examId).get();
  if (!examSnap.exists) throw new ExamsServiceError("Exam not found.", 404);
  const exam = examSnap.data()!;
  if (actor.role === "admin" && exam.schoolId && exam.schoolId !== actor.schoolId) {
    throw new ExamsServiceError("This exam belongs to another school.", 403);
  }

  /**
   * The review gate.
   *
   * Enforced here rather than only in the UI because the assign dialog is not the
   * only caller — a stale tab, a replayed form post and a future bulk-assign all
   * arrive at this function, and "the button was disabled" is not a permission.
   *
   * `isAssignGated` limits this to `draft` exams: anything already `scheduled` or
   * `active` was assigned before this screen existed, so gating it now would fault
   * work that was legitimate when it was done.
   */
  const assertReviewGate = (
    candidate: Pick<ExamDoc, "status" | "questions" | "review">,
  ): boolean => {
    const candidateGated = isAssignGated(candidate);
    if (candidateGated && !input.acknowledgeUnreviewed) {
      const { approved, total } = reviewProgress(candidate.questions, candidate.review);
      throw new ExamsServiceError(
        `Review the questions before assigning — ${approved} of ${total} approved.`,
        409,
      );
    }
    return candidateGated;
  };
  assertReviewGate(exam);

  // Enforce that every referenced student actually belongs to this admin
  // (same school / standalone household). Prevents assigning exams to
  // arbitrary student ids across the platform.
  // Firestore "in" queries accept max 10 values (was 30 in older SDKs).
  const CHUNK = 10;
  const allowedIds = new Set<string>();
  for (let i = 0; i < input.studentIds.length; i += CHUNK) {
    const chunk = input.studentIds.slice(i, i + CHUNK);
    let query = usersCol().where("role", "==", "student");
    if (actor.role === "admin" && actor.schoolId) {
      query = query.where("schoolId", "==", actor.schoolId);
    } else if (actor.role === "admin") {
      query = query.where("createdBy", "==", actor.uid);
    }
    const snap = await query.where(FieldPath.documentId(), "in", chunk).get();
    snap.docs.forEach((d) => allowedIds.add(d.id));
  }
  const rejected = input.studentIds.filter((id) => !allowedIds.has(id));
  if (rejected.length > 0) {
    throw new ExamsServiceError(
      `${rejected.length} selected student(s) are not in your school.`,
      403,
    );
  }

  let scheduledAt: Timestamp | null = null;
  if (input.scheduledFor) {
    const parsedMs = Date.parse(input.scheduledFor);
    if (isNaN(parsedMs)) {
      throw new ExamsServiceError("Invalid scheduledFor date.", 400);
    }
    scheduledAt = Timestamp.fromMillis(parsedMs);
  }
  // The exam status is the question-edit lock. Reading it, creating attempts and
  // leaving draft in one transaction means `saveQuestions` cannot commit between
  // the first attempt write and the status transition.
  const assignment = await adminDb().runTransaction(async (tx) => {
    const lockedExamRef = examDoc(input.examId);
    const lockedExamSnap = await tx.get(lockedExamRef);
    if (!lockedExamSnap.exists) throw new ExamsServiceError("Exam not found.", 404);
    const lockedExam = lockedExamSnap.data()!;
    if (
      actor.role === "admin" &&
      lockedExam.schoolId &&
      lockedExam.schoolId !== actor.schoolId
    ) {
      throw new ExamsServiceError("This exam belongs to another school.", 403);
    }
    const gated = assertReviewGate(lockedExam);

    // Skip students who already have an open/unfinished attempt for this exam.
    // These reads share the transaction with the writes, preventing two concurrent
    // assignments from creating duplicate open attempts.
    const openStatuses = ["pending", "in_progress", "submitted"] as const;
    const hasOpenAttempt = new Set<string>();
    for (let i = 0; i < input.studentIds.length; i += CHUNK) {
      const chunk = input.studentIds.slice(i, i + CHUNK);
      const existing = await tx.get(
        attemptsCol()
          .where("examId", "==", input.examId)
          .where("studentId", "in", chunk)
          .where("status", "in", [...openStatuses]),
      );
      existing.docs.forEach((d) => hasOpenAttempt.add(d.data().studentId as string));
    }

    const studentIds = input.studentIds.filter((id) => !hasOpenAttempt.has(id));
    if (studentIds.length === 0) return { created: 0, gated };

    const now = FieldValue.serverTimestamp();
    const base: WriteModel<AttemptDoc> = {
      examId: input.examId,
      studentId: "",
      schoolId: lockedExam.schoolId,
      status: "pending",
      scheduledFor: scheduledAt,
      startedAt: null,
      submittedAt: null,
      autoSubmitted: false,
      timeSpentSeconds: null,
      answers: [],
      score: null,
      violationsCount: 0,
      warningsIssued: 0,
      recordings: { cameraPath: null, screenPath: null },
      gradedAt: null,
      feedback: null,
      retakeOf: null,
      retakeAuthorizedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    for (const studentId of studentIds) {
      tx.create(attemptsCol().doc(), { ...base, studentId });
    }

    const nextStatus = lockedExam.status === "draft" ? "scheduled" : lockedExam.status;
    // Stamp the override on the document, not just the audit log. The library and
    // the review screen both show whether an exam went out unreviewed, and an admin
    // looking at a paper a student is already sitting should not have to read the
    // audit trail to find that out.
    //
    // Written as a whole `review` object rather than as `review.overriddenAt` dotted
    // paths: the field is optional on `ExamDoc`, so a dotted update would not
    // typecheck against `UpdateData<ExamDoc>`.
    if (gated) {
      const stampedAt = new Date().toISOString();
      tx.update(lockedExamRef, {
        status: nextStatus,
        review: {
          ...readReview(lockedExam.review),
          overriddenAt: stampedAt,
          updatedAt: stampedAt,
        },
        updatedAt: now,
      });
    } else {
      tx.update(lockedExamRef, { status: nextStatus, updatedAt: now });
    }

    return { created: studentIds.length, gated };
  });
  const { created, gated } = assignment;

  await writeAudit({
    actorId: actor.uid,
    actorRole: actor.role,
    action: "exam.assigned",
    targetType: "exam",
    targetId: input.examId,
    meta: {
      students: created,
      scheduledFor: input.scheduledFor,
      ...(gated && created > 0 ? { unreviewedOverride: true } : {}),
    },
  });

  return created;
}

export async function listExams(
  actor: SessionUser,
  limit = 200,
): Promise<WithId<ExamDoc>[]> {
  let query: FirebaseFirestore.Query<ExamDoc> = examsCol().orderBy("createdAt", "desc").limit(limit);
  if (actor.role === "admin" && actor.schoolId) {
    query = examsCol()
      .where("schoolId", "==", actor.schoolId)
      .orderBy("createdAt", "desc")
      .limit(limit);
  } else if (actor.role === "admin") {
    query = examsCol()
      .where("createdBy", "==", actor.uid)
      .orderBy("createdAt", "desc")
      .limit(limit);
  }
  let snap: FirebaseFirestore.QuerySnapshot<ExamDoc>;
  try {
    snap = await query.get();
  } catch {
    let fallbackQuery: FirebaseFirestore.Query<ExamDoc> = examsCol().limit(limit);
    if (actor.role === "admin" && actor.schoolId) {
      fallbackQuery = examsCol().where("schoolId", "==", actor.schoolId).limit(limit);
    } else if (actor.role === "admin") {
      fallbackQuery = examsCol().where("createdBy", "==", actor.uid).limit(limit);
    }
    snap = await fallbackQuery.get();
  }
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data?.createdAt ?? (d.createTime as unknown as Timestamp),
      updatedAt: data?.updatedAt ?? (d.updateTime as unknown as Timestamp) ?? data?.createdAt ?? (d.createTime as unknown as Timestamp),
    };
  });
}

export async function getExamForActor(
  actor: SessionUser,
  examId: string,
): Promise<WithId<ExamDoc>> {
  const snap = await examDoc(examId).get();
  if (!snap.exists) throw new ExamsServiceError("Exam not found.", 404);
  const exam = { id: snap.id, ...snap.data()! } as WithId<ExamDoc>;
  const allowed =
    actor.role === "super_admin" ||
    (actor.role === "admin" &&
      (exam.createdBy === actor.uid || (exam.schoolId && exam.schoolId === actor.schoolId))) ||
    (actor.role === "student" && exam.schoolId && exam.schoolId === actor.schoolId);
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return exam;
}

export async function getAttemptForActor(
  actor: SessionUser,
  attemptId: string,
): Promise<WithId<AttemptDoc>> {
  const snap = await attemptDoc(attemptId).get();
  if (!snap.exists) throw new ExamsServiceError("Attempt not found.", 404);
  const attempt = { id: snap.id, ...snap.data()! } as WithId<AttemptDoc>;
  const allowed =
    actor.role === "super_admin" ||
    attempt.studentId === actor.uid ||
    (actor.role === "admin" &&
      attempt.schoolId !== null &&
      attempt.schoolId === actor.schoolId);
  if (!allowed) throw new ExamsServiceError("Not allowed.", 403);
  return attempt;
}
