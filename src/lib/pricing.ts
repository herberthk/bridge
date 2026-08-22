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

/** Rough pre-flight estimate for AI-grading an attempt of n answers. */
export function estimateGradingTokens(questionCount: number): number {
  return questionCount * 500 + 800;
}

/** Popular top-up packs shown in the wallet UI (tokens). */
export const TOPUP_PACKS = [
  { tokens: 100_000, label: "Starter" },
  { tokens: 500_000, label: "Class" },
  { tokens: 2_000_000, label: "School" },
  { tokens: 10_000_000, label: "District" },
] as const;
