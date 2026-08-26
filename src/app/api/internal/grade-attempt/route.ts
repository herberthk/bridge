import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

import { gradeAttemptWithAi } from "@/server/services/grading";

/**
 * Internal endpoint for trusted server-side callers only (e.g. the Cloud
 * Functions sweeper that auto-submits expired attempts). Not reachable by
 * normal users: every request must present the shared secret in the
 * `x-internal-secret` header, compared in constant time.
 *
 * Configure both sides with the same value:
 *   - Next.js: INTERNAL_API_SECRET env var
 *   - Functions: defineSecret / environment variable of the same value
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  const provided = request.headers.get("x-internal-secret");
  if (!expected || !provided) return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // timingSafeEqual throws on length mismatch — pad to equal length first so
  // the comparison still runs in constant time without leaking the length.
  if (a.length !== b.length) {
    // Different lengths can never match; burn an equivalent comparison anyway.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { attemptId?: string }
    | null;
  const attemptId = body?.attemptId;
  if (!attemptId || typeof attemptId !== "string") {
    return NextResponse.json(
      { error: "attemptId is required." },
      { status: 400 },
    );
  }

  try {
    // gradeAttemptWithAi is idempotent-ish: it no-ops unless the attempt is
    // still in "submitted", and objective-only attempts finalize instantly.
    await gradeAttemptWithAi(attemptId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[internal/grade-attempt] failed", err);
    return NextResponse.json(
      { error: "Grading failed." },
      { status: 500 },
    );
  }
}
