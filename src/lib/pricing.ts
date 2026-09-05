import { BILLING } from "@/lib/constants";

/**
 * Pure billing math — unit-tested, no I/O. All USD amounts are tracked as
 * integer micro-dollars (1 USD = 1,000,000 micros) to avoid float drift.
 */

export const MICROS_PER_USD = 1_000_000;

/** $0.027 per 1,000 tokens → 27 micro-dollars per token. */
export const MICROS_PER_TEXT_TOKEN = Math.round(
  (BILLING.usdPer1kTextTokens * MICROS_PER_USD) / 1000,
);

/** $0.08 per voice minute. */
export const MICROS_PER_VOICE_MINUTE = Math.round(
  BILLING.usdPerVoiceMinute * MICROS_PER_USD,
);

/** Cost in micro-dollars for a number of text tokens. */
export function textTokensToMicros(tokens: number): number {
  return Math.round(tokens * MICROS_PER_TEXT_TOKEN);
}

/** Cost in micro-dollars for voice minutes (fractional minutes allowed). */
export function voiceMinutesToMicros(minutes: number): number {
  return Math.round(minutes * MICROS_PER_VOICE_MINUTE);
}

/** USD price for a token top-up pack of the given size. */
export function tokensToUsd(tokens: number): number {
  return textTokensToMicros(tokens) / MICROS_PER_USD;
}

/** USD price for voice minutes. */
export function voiceMinutesToUsd(minutes: number): number {
  return voiceMinutesToMicros(minutes) / MICROS_PER_USD;
}

export function usdMicrosToUgx(micros: number): number {
  return Math.round((micros / MICROS_PER_USD) * BILLING.ugxPerUsd);
}

export function usdToUgx(usd: number): number {
  return Math.round(usd * BILLING.ugxPerUsd);
}

/** e.g. 12.5 → "UGX 47,500" */
export function formatUgx(ugx: number): string {
  return `UGX ${Math.round(ugx).toLocaleString("en-UG")}`;
}

/** e.g. 0.027 → "$0.03" (2dp); 1234.5 → "$1,234.50" */
export function formatUsd(usd: number): string {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}

/** Rough pre-flight estimate for generating an exam of n questions. */
export function estimateGenerationTokens(questionCount: number, hasDocuments: boolean): number {
  // ~700 tokens per question round-trip (prompt share + output), plus a
  // document-grounding overhead when past papers are attached.
  const perQuestion = 700;
  const docOverhead = hasDocuments ? 6000 : 1200;
  return questionCount * perQuestion + docOverhead;
}

/**
 * Head-room multiplier applied to the pre-flight affordability check.
 *
 * The reservation must cover the *typical* worst case, not the theoretical one:
 * retries and the chunked fallback re-spend roughly a generation's worth of
 * tokens each, but they are mutually exclusive in practice (a run that succeeds
 * on attempt 1 never chunks). Actual usage is billed after the fact, so
 * under-reserving costs at most one over-spent generation while over-reserving
 * blocks the feature outright.
 *
 * Lives here rather than in the exams service so the wizard can quote the same
 * number the server will demand — a cost card that shows 1× while
 * `assertCanAfford` requires 3× sends admins into an avoidable 402.
 */
export const GENERATION_RESERVE_MULTIPLIER = 3;

/** Tokens a wallet must hold before a generation is allowed to start. */
export function reserveForGeneration(estimatedTokens: number): number {
  return estimatedTokens * GENERATION_RESERVE_MULTIPLIER;
}

/**
 * Rough pre-flight estimate for revising n questions on the review screen.
 *
 * Costed higher per question than generation because a revision pays for the
 * question twice: the stored version goes in as JSON so the model can see which
 * fields exist, and the whole rewrite comes back out. Generation only pays for the
 * output. The flat term is the instruction block, which is nearly the generation
 * one — the maths, visual and type rules are shared verbatim.
 */
export function estimateRevisionTokens(questionCount: number): number {
  return questionCount * 1200 + 1500;
}

/**
 * Head-room on a revision, including both its input allowance and output ceiling.
 *
 * `reviseQuestions` can accept up to the full configured output cap after also
 * sending the stored questions and instructions as input. Reserving four times the
 * estimate keeps the eventual debit within the amount that passed pre-flight.
 */
export const REVISION_RESERVE_MULTIPLIER = 4;

/** Tokens a wallet must hold before a revision is allowed to start. */
export function reserveForRevision(estimatedTokens: number): number {
  return estimatedTokens * REVISION_RESERVE_MULTIPLIER;
}

/** Rough pre-flight estimate for AI-grading an attempt of n answers. */
export function estimateGradingTokens(questionCount: number): number {
  return questionCount * 500 + 800;
}

/**
 * Token cost of one "standard" exam (15 questions with grounding documents).
 *
 * Single source of truth for capacity displays: equals
 * `estimateGenerationTokens(15, true)` (15 × 700 + 6000). Dashboard, wallet
 * and voice copy must reference this instead of magic numbers so the figures
 * can't drift apart again. This is the *token cost*, not the pre-flight hold —
 * see STANDARD_EXAM_RESERVE for the amount the server actually demands.
 */
export const STANDARD_EXAM_TOKEN_ESTIMATE = estimateGenerationTokens(15, true);

/**
 * Tokens a wallet must hold to start one standard exam. Same 3× policy the
 * cost calculator quotes (`reserveForGeneration`) and `assertCanAfford`
 * enforces, so the low-balance banner can't disagree with either.
 *
 * Kept separate from STANDARD_EXAM_TOKEN_ESTIMATE on purpose: capacity
 * ("≈ N exams worth of tokens") divides by cost, while startability divides
 * by reserve. Conflating them shows "1 exam capacity" next to a "low fuel"
 * banner at the same balance.
 */
export const STANDARD_EXAM_RESERVE = reserveForGeneration(STANDARD_EXAM_TOKEN_ESTIMATE);

/** Popular top-up packs shown in the wallet UI (tokens). */
export const TOPUP_PACKS = [
  { tokens: 100_000, label: "Starter" },
  { tokens: 500_000, label: "Class" },
  { tokens: 2_000_000, label: "School" },
  { tokens: 10_000_000, label: "District" },
] as const;
