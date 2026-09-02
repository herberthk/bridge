import { NextResponse, type NextRequest } from "next/server";

import { apiUser } from "@/server/auth/session";
import { getExamForActor, ExamsServiceError } from "@/server/services/exams";

/**
 * Full exam document — INCLUDING the answer key (correctOptionIndex,
 * acceptableAnswers, explanations). Staff only. Students receive the
 * sanitized `SafeQuestion` shape via `startAttempt` and must never be able
 * to reach this route: `getExamForActor` would happily authorize a student
 * for any exam in their school.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ examId: string }> },
) {
  const actor = await apiUser("admin", "teacher", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { examId } = await ctx.params;
  if (!examId || examId === "generate") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const exam = await getExamForActor(actor, examId);
    return NextResponse.json({ exam }, { status: 200 });
  } catch (err) {
    const status = err instanceof ExamsServiceError ? err.status : 500;
    const message = err instanceof ExamsServiceError ? err.message : "Failed to load exam.";
    return NextResponse.json({ error: message }, { status });
  }
}
