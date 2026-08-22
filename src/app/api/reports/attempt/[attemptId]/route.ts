import { NextResponse, type NextRequest } from "next/server";

import { apiUser } from "@/server/auth/session";
import { getAttemptDetail, AttemptsServiceError } from "@/server/services/attempts";
import { renderAttemptReport } from "@/server/services/reports";
import { userDoc } from "@/server/firebase/collections";

/** Download the PDF performance report for an attempt. */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ attemptId: string }> },
) {
  const actor = await apiUser("student", "admin", "super_admin");
  if (!actor) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { attemptId } = await ctx.params;
  try {
    const { attempt, exam } = await getAttemptDetail(actor, attemptId);
    if (!exam) {
      return NextResponse.json({ error: "Exam data missing." }, { status: 404 });
    }
    const userSnap = await userDoc(attempt.studentId).get();
    const student = userSnap.exists
      ? { displayName: userSnap.data()!.displayName, email: userSnap.data()!.email }
      : { displayName: "Student", email: "" };

    const pdf = await renderAttemptReport(attempt, exam, student);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="bridge-report-${attemptId}.pdf"`,
      },
    });
  } catch (err) {
    const status = err instanceof AttemptsServiceError ? err.status : 500;
    const message =
      err instanceof AttemptsServiceError ? err.message : "Report generation failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
