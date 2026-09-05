import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { generateText, Output } from "ai";
import type { LanguageModelCallEndEvent } from "ai";

import { modelIds } from "@/server/ai/provider";
import {
  chunkDocumentText,
  examGenerationInstructions,
  examGenerationPrompt,
} from "@/server/ai/prompts";
import { examsCol } from "@/server/firebase/collections";
import { writeAudit } from "@/server/services/audit";
import {
  assertCanAfford,
  consumeTokens,
  InsufficientTokensError,
} from "@/server/services/billing";
import { loadDocumentExcerpts } from "@/server/services/documents";
import type { SessionUser } from "@/server/auth/session";
import type {
  ExamDoc,
  ExamParams,
  Question,
  WithId,
  WriteModel,
} from "@/types/firestore";
import type { ExamOutput, GenerateExamInput } from "@/lib/schemas/exam";
import { examOutputSchema } from "@/lib/schemas/exam";
import { repairMath } from "@/lib/exam/latex";
import { estimateGenerationTokens, reserveForGeneration } from "@/lib/pricing";
import { vertex } from "@/lib/vertext";
import { ExamsServiceError } from "./errors";
import {
  AI_CALL_RETRIES,
  CHUNK_ATTEMPTS,
  estimateOutputTokens,
  GENERATION_BUDGET_MS,
  MAX_FULL_ATTEMPTS,
  MIN_CALL_SLICE_MS,
  msForTokens,
  outputCapFor,
  OUTPUT_CAP_HEADROOM,
  planGeneration,
  SAVE_RESERVE_MS,
  thinkingOptions,
  tooLargeError,
} from "./planning";
import { repairProse, sanitizeVisual } from "./content";
import { isAbortError, isRetryableAiError, readUsage } from "./ai-errors";
import { resolveExamClassId } from "./scope";

/** Shared wording for every way the pipeline can run out of wall clock. */
function outOfTimeError(done: number, total: number): ExamsServiceError {
  return new ExamsServiceError(
    `Generation ran out of time${done > 0 ? ` after ${done}/${total} questions` : ""}. ` +
      `Try again with a lower question count, or turn off hints, explanations and worked examples.`,
    504,
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

  // Scope validation runs before the affordability check so authorization
  // errors surface before billing ones.
  const classId = await resolveExamClassId(actor, input);

  await assertCanAfford(walletId, reserveForGeneration(estimate));

  // Deadline/expiry: after this instant students can no longer start the exam.
  let expiresAt: Timestamp | null = null;
  if (input.expiresAt) {
    const ms = Date.parse(input.expiresAt);
    if (Number.isNaN(ms)) throw new ExamsServiceError("Invalid expiry date.", 400);
    if (ms <= Date.now()) {
      throw new ExamsServiceError("The deadline must be in the future.", 400);
    }
    expiresAt = Timestamp.fromMillis(ms);
  }

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
        : `skipped (~${Math.round(plan.estFullMs / 1_000)}s > 35s)`}; ` +
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
  // Chunked once up front: every attempt used to re-chunk every document, so a
  // 20-chunk exam paid the chunking pass twenty-plus times for identical input.
  const groundedDocs = excerpts.map((d) => ({ name: d.name, text: chunkDocumentText(d.text) }));

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
    const prompt = examGenerationPrompt(params, groundedDocs);
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
    const retryDetail = wasTruncated
      ? "previous attempt reached the cap without closing its JSON, "
      : "";
    console.warn(
      `[exams] gen ${attemptLabel} retrying shaped call at the same ${shapedCap} token cap: ` +
        `${retryDetail}re-rolling with provider-default sampling`,
    );
    const fallbackStartedAt = Date.now();
    const retryProbe = roundTripProbe(`${attemptLabel} retry`);
    const result = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: examOutputSchema }),
      maxOutputTokens: shapedCap,
      // Sampling is provider-default on both attempts (no temperature override) —
      // the retry is a fresh sample, not a forced one. A truncation gets the same
      // default sample as any other failure: reaching the cap means the model
      // repeated itself into it, and re-rolling samples past that.
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
        `35s — going straight to chunked`,
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
    classId,
    expiresAt,
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
