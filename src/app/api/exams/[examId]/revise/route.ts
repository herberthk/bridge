import { NextResponse, type NextRequest } from "next/server";

import { reviseQuestionsSchema } from "@/lib/schemas/exam-review";
import { apiUser } from "@/server/auth/session";
import { reviseQuestions } from "@/server/services/exam-review";
import { ExamsServiceError } from "@/server/services/exams";
import { BillingError } from "@/server/services/billing";

/**
 * Wall clock for one revision batch.
 *
 * Well under the generator's 180s because a revision is a single call over at most
 * ten questions, and the service aborts its own call at 70s. The gap between the two
 * covers auth, the exam read, the billing write and serialising the proposals.
 *
 * A route rather than a Server Action, unlike the save and approve paths: this is
 * the only part of the review screen that waits on a model, and it needs its own
 * duration and its own error envelope. Everything else on the screen writes in
 * milliseconds and goes through `actions.ts`.
 */
export const maxDuration = 90;

/** AI revision of specific questions — metered, and writes nothing to the exam. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { examId } = await params;
  const body = await request.json().catch(() => null);
  // The path is authoritative for the exam id. Taking it from the body as well
  // would let a request address one exam in the URL and another in the payload.
  const parsed = reviseQuestionsSchema.safeParse({
    ...(body && typeof body === "object" ? body : {}),
    examId,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const result = await reviseQuestions(actor, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/exams/revise] failed", err, {
      examId,
      questions: parsed.data.items.length,
    });
    const known = err instanceof ExamsServiceError || err instanceof BillingError;
    return NextResponse.json(
      { error: known ? err.message : "The revision failed. Try again." },
      { status: known ? err.status : 500 },
    );
  }
}
