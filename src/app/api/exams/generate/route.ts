import { NextResponse, type NextRequest } from "next/server";

import { generateExamSchema } from "@/lib/schemas/exam";
import { apiUser } from "@/server/auth/session";
import { generateExam, ExamsServiceError } from "@/server/services/exams";
import { BillingError } from "@/server/services/billing";

/**
 * Wall clock this route is allowed to run for.
 *
 * Raised from 120s to fund the largest exam the product offers: 60 questions with
 * hints, explanations and worked examples is ~31,000 output tokens, which is more
 * model time than 120s can hold even spread across six concurrent chunks.
 * `GENERATION_BUDGET_MS` in the service is set 30s under this, and that gap is the
 * part of the request this clock covers but that budget does not — auth, the
 * document reads, the Firestore write and serialising the response.
 *
 * Needs a host that honours it: Vercel Hobby caps functions at 60s regardless, and
 * Firebase App Hosting needs `runConfig.timeoutSeconds` raised to match. On a host
 * that silently caps lower, a 60-question exam is killed mid-flight rather than
 * refused up front, so this value and the deployment config have to move together.
 */
export const maxDuration = 180;

/** AI exam generation — metered against the caller's wallet. */
export async function POST(request: NextRequest) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = generateExamSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const { exam, tokensUsed, warnings } = await generateExam(actor, parsed.data);
    return NextResponse.json({
      ok: true,
      examId: exam.id,
      title: exam.title,
      questions: exam.questions.length,
      tokensUsed,
      // Non-fatal degradations from after the exam was saved (stripped visuals,
      // a failed deduction). The wizard surfaces these alongside its success state.
      warnings,
    });
  } catch (err) {
    console.error("[api/exams/generate] failed", err, {
      stack: err instanceof Error ? err.stack : undefined,
      cause: (err as unknown as { cause?: unknown })?.cause,
      params: parsed.data?.params,
    });
    const status =
      err instanceof ExamsServiceError || err instanceof BillingError
        ? err.status
        : 500;
    const message =
      err instanceof ExamsServiceError || err instanceof BillingError
        ? err.message
        : "Generation failed";
    return NextResponse.json({ error: message }, { status });
  }
}
