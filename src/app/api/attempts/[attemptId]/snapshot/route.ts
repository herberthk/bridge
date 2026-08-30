import { NextResponse, type NextRequest } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";

import { google } from "@/server/ai/provider";
import { apiUser } from "@/server/auth/session";
import {
  assertAttemptOwner,
  logProctorEvent,
  AttemptsServiceError,
} from "@/server/services/attempts";
import { consumeTokens } from "@/server/services/billing";
import { vertex } from "@/lib/vertext";

const bodySchema = z.object({
  imageBase64: z.string().min(64).max(8 * 1024 * 1024),
});

const verdictSchema = z.object({
  verdict: z.enum(["ok", "warning", "violation"]),
  category: z.enum(["no_face", "multiple_faces", "phone_detected", "suspicious_activity", "ok"]),
  reason: z.string().max(300),
});

/** AI analysis of a proctoring camera snapshot (vision). */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid snapshot." }, { status: 400 });
  }
  const { attemptId } = await ctx.params;

  // Ownership gate BEFORE the paid AI call — prevents burning wallet tokens
  // by posting snapshots against another student's attempt id.
  try {
    await assertAttemptOwner(actor, attemptId);
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Not allowed.";
    return NextResponse.json({ error: message }, { status });
  }

  let verdict: z.infer<typeof verdictSchema>;
  let tokensUsed = 0;
  try {
    const bytes = Buffer.from(parsed.data.imageBase64, "base64");
    const result = await generateText({
      model: vertex("gemini-3.7-flash"),
      // google()(
      //   process.env.BRIDGE_MODEL_SNAPSHOT ?? "gemini-3.5-flash-lite",
      // ),
      instructions: [
        "You are an exam proctoring vision model. Analyze this webcam snapshot of a student taking an online exam.",
        "verdict: ok = one student visibly working normally; warning = minor concern; violation = clear problem.",
        "Categories: no_face (student absent), multiple_faces (another person present),",
        "phone_detected (phone or second device visible), suspicious_activity (only what is actually visible).",
        "Be conservative: report only what you can see. `reason` must be one short sentence.",
      ].join("\n"),
      prompt: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Analyze this exam snapshot." },
            {
              type: "file" as const,
              data: new Uint8Array(bytes),
              mediaType: "image/jpeg",
            },
          ],
        },
      ],
      output: Output.object({ schema: verdictSchema }),
      maxOutputTokens: 2_000,
    });
    verdict = result.output;
    const usage = result.usage;
    tokensUsed = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  } catch (err) {
    console.error("[snapshot] analysis failed", err);
    // Never punish the student for infrastructure failures.
    return NextResponse.json({ ok: true, verdict: "ok", category: "ok", reason: "" });
  }

  let outcome: Awaited<ReturnType<typeof logProctorEvent>> | null = null;
  if (verdict.verdict !== "ok") {
    try {
      outcome = await logProctorEvent(actor, attemptId, {
        type: verdict.category === "ok" ? "ai_flag" : verdict.category,
        severity: verdict.verdict === "violation" ? "high" : "medium",
        details: { snapshot: true },
        aiVerdict: verdict.reason,
      });
    } catch (err) {
      if (err instanceof AttemptsServiceError && err.status === 403) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      console.error("[snapshot] event log failed", err);
    }
  }

  // Bill snapshot tokens to the owning wallet (proctoring overhead).
  const billTo = actor.schoolId ?? actor.uid; // school or standalone household
  if (tokensUsed > 0) {
    void consumeTokens({
      walletId: billTo,
      tokens: tokensUsed,
      category: "text_generation",
      description: "Proctoring snapshot analysis",
      refType: "attempt",
      refId: attemptId,
      actorId: null,
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    verdict: verdict.verdict,
    category: verdict.category,
    reason: verdict.reason,
    ...(outcome ? { warnings: outcome.warnings, action: outcome.action } : {}),
  });
}
