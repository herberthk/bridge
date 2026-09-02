import { NextResponse } from "next/server";
import { experimental_getRealtimeToolDefinitions, tool } from "ai";
import { z } from "zod";

import { google, modelIds } from "@/server/ai/provider";
import { apiUser } from "@/server/auth/session";

/**
 * Mints a short-lived Gemini Live token for the voice exam builder and
 * returns the tool definitions the session should expose. Tool calls are
 * executed client-side (they build the draft exam spec).
 */
export async function POST() {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const tools = {
    setSubject: tool({
      description: "Set the exam subject.",
      inputSchema: z.object({
        subject: z.enum([
          "mathematics", "english", "science", "social_studies", "physics",
          "chemistry", "biology", "geography", "history", "computer_studies",
          "commerce", "agriculture", "cre", "ire", "literature_in_english",
          "economics_entrepreneurship",
        ]),
      }),
    }),
    setLevel: tool({
      description:
        "Set the school level, class, and (for secondary) the sub-level. O level is S1-S4, A level is S5-S6.",
      inputSchema: z.object({
        level: z.enum(["primary", "secondary"]),
        subLevel: z.enum(["o_level", "a_level"]).nullable().optional(),
        classLevel: z.number().int().min(1).max(7),
      }),
    }),
    setSubsidiary: tool({
      description:
        "For History, set the branch: european_history or african_history.",
      inputSchema: z.object({
        subsidiary: z.enum(["european_history", "african_history"]),
      }),
    }),
    setTopic: tool({
      description: "Set the topic or theme of the exam.",
      inputSchema: z.object({ topic: z.string().min(2).max(200) }),
    }),
    setDifficulty: tool({
      description: "Set difficulty.",
      inputSchema: z.object({ difficulty: z.enum(["easy", "medium", "hard", "very_hard"]) }),
    }),
    setDuration: tool({
      description: "Set the exam duration in minutes (5–240).",
      inputSchema: z.object({ minutes: z.number().int().min(5).max(240) }),
    }),
    setQuestionCount: tool({
      description: "Set the number of questions (1–100).",
      inputSchema: z.object({ count: z.number().int().min(1).max(100) }),
    }),
    setQuestionTypes: tool({
      description: "Set the question types to include.",
      inputSchema: z.object({
        types: z.array(
          z.enum([
            "multiple_choice", "true_false", "fill_in_the_blank",
            "short_answer", "essay", "matching",
          ]),
        ).min(1),
      }),
    }),
    setInclude: tool({
      description: "Toggle hints, explanations, and worked examples.",
      inputSchema: z.object({
        hints: z.boolean().optional(),
        explanations: z.boolean().optional(),
        workedExamples: z.boolean().optional(),
      }),
    }),
  };

  try {
    const [token, toolDefinitions] = await Promise.all([
      google().experimental_realtime.getToken({
        model: modelIds.live(),
        sessionConfig: {
          instructions: [
            "You are Bridge's voice exam builder for Ugandan school teachers.",
            "Interview the teacher briefly, then build their exam spec using the tools.",
            "Ask one question at a time. Confirm each field as you set it.",
            "When the spec is complete, summarize it and suggest they review it on screen.",
          ].join(" "),
          inputAudioTranscription: {},
          voice: "Charon",
        },
      }),
      experimental_getRealtimeToolDefinitions({ tools }),
    ]);
    return NextResponse.json({
      token: token.token ?? token,
      expiresAt: token.expiresAt ?? null,
      toolDefinitions,
    });
  } catch (err) {
    console.error("[voice] token failed", err);
    return NextResponse.json(
      { error: "Could not start a voice session. Is GOOGLE_GENERATIVE_AI_API_KEY set?" },
      { status: 502 },
    );
  }
}
