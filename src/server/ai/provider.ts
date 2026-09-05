import { createGoogle, type GoogleProvider } from "@ai-sdk/google";

/**
 * Gemini provider wiring. The API key comes from GOOGLE_GENERATIVE_AI_API_KEY
 * (see .env.example); model ids are env-overridable with sensible defaults.
 */

let cached: GoogleProvider | null = null;

export function google(): GoogleProvider {
  if (!cached) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY is not set — add it to .env.local (https://aistudio.google.com/apikey).",
      );
    }
    cached = createGoogle({ apiKey });
  }
  return cached;
}

/**
 * Model id used for a call — recorded on docs for transparency.
 *
 * The defaults track what the exam pipeline's timing envelope was actually
 * measured on. `exams.ts` derives its slices from a throughput figure taken off a
 * real `gemini-3.8-flash` round trip, and `thinkingOptions` branches on the major
 * version — 3.x takes `thinkingLevel`, 2.5 takes a numeric `thinkingBudget` — so a
 * default from the other generation would silently plan against numbers nothing
 * measured. Overridable per environment via `BRIDGE_MODEL_*`.
 */
export const modelIds = {
  text: () => process.env.BRIDGE_MODEL_TEXT ?? "gemini-3.8-flash",
  /**
   * The escalation target for a chunk that has already failed twice.
   *
   * Deliberately another flash model rather than a Pro one: the escalation reuses
   * the chunk's slice, and that slice is sized from flash throughput. A Pro model
   * reasons for considerably longer, so pointing this at one turns the last
   * attempt into a guaranteed abort — an escalation that cannot finish is worse
   * than no escalation. Raising it means raising the slice too.
   */
  textPro: () => process.env.BRIDGE_MODEL_TEXT_PRO ?? "gemini-3.8-flash",
  live: () => process.env.BRIDGE_MODEL_LIVE ?? "gemini-3.1-flash-live-preview",
};

/** Gemini 3.x rejects temperature; other configured model families retain it. */
export function temperatureOptions(
  modelId: string,
  temperature: number,
): { temperature?: number } {
  return /(?:^|\/)gemini-3(?:[.-]|$)/i.test(modelId) ? {} : { temperature };
}

/** Fast, balanced default for generation + grading. */
export function textModel() {
  return google()(modelIds.text());
}

/** Pro model for harder tasks (optional, switch per call). */
export function textProModel() {
  // Reads through `modelIds` rather than re-reading the env: the id recorded on
  // the document and the id actually called have to be the same string, and an
  // inline duplicate is one edit away from making them differ.
  return google()(modelIds.textPro());
}
