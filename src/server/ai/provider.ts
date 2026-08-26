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

/** Model id used for a call — recorded on docs for transparency. */
export const modelIds = {
  text: () => process.env.BRIDGE_MODEL_TEXT ?? "gemini-3.6-flash",
  textPro: () => process.env.BRIDGE_MODEL_TEXT_PRO ?? "gemini-3.1-pro-preview",
  live: () => process.env.BRIDGE_MODEL_LIVE ?? "gemini-live-2.5-flash-native-audio",
};

/** Fast, balanced default for generation + grading. */
export function textModel() {
  return google()(modelIds.text());
}

/** Pro model for harder tasks (optional, switch per call). */
export function textProModel() {
  return google()(process.env.BRIDGE_MODEL_TEXT_PRO ?? "gemini-3.1-pro-preview");
}
