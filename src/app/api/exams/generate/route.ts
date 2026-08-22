import { NextResponse, type NextRequest } from "next/server";

import { generateExamSchema } from "@/lib/schemas/exam";
import { apiUser } from "@/server/auth/session";
import { generateExam, ExamsServiceError } from "@/server/services/exams";
import { BillingError } from "@/server/services/billing";

/** AI exam generation — metered against the caller's wallet. */
export async function POST(request: NextRequest) {
  const actor = await apiUser("admin", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const parsed = generateExamSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const { exam, tokensUsed } = await generateExam(actor, parsed.data);
    return NextResponse.json({
      ok: true,
      examId: exam.id,
      title: exam.title,
      questions: exam.questions.length,
      tokensUsed,
    });
  } catch (err) {
    const status =
      err instanceof ExamsServiceError || err instanceof BillingError
        ? err.status
        : 500;
    const message =
      err instanceof ExamsServiceError || err instanceof BillingError
        ? err.message
        : "Generation failed. Try again.";
    return NextResponse.json({ error: message }, { status });
  }
}
