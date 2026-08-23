/**
 * Full-stack integration test against the REAL Firebase + Gemini project.
 * Run: bun --env-file=.env.local scripts/integration-test.ts
 *
 * Creates a throwaway school/admin/student, tops up the school wallet,
 * generates a real AI exam (A-level History, African branch), walks the
 * attempt lifecycle (start → proctoring two-warning policy → submit →
 * AI grading → PDF report), verifies billing debits, then cleans up every
 * test artifact. Leaves platform audit-log entries behind (append-only).
 */

import { generateText } from "ai";

import { textModel } from "@/server/ai/provider";
import {
  adminAuth,
  adminDb,
} from "@/server/firebase/admin";
import {
  attemptDoc,
  attemptsCol,
  examDoc,
  examsCol,
  schoolDoc,
  schoolsCol,
  transactionsCol,
  userDoc,
  usersCol,
  walletDoc,
} from "@/server/firebase/collections";
import { topupWallet } from "@/server/services/billing";
import {
  assignExam,
  generateExam,
} from "@/server/services/exams";
import {
  attachRecordings,
  logProctorEvent,
  startAttempt,
  submitAttempt,
} from "@/server/services/attempts";
import { gradeAttemptWithAi } from "@/server/services/grading";
import { createStudent } from "@/server/services/users";
import { createSchoolWithOwner } from "@/server/services/schools";
import { renderAttemptReport } from "@/server/services/reports";
import type { SessionUser } from "@/server/auth/session";

let passed = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (!condition) throw new Error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
  console.log(`✓ ${name}${detail ? ` (${detail})` : ""}`);
}

const stamp = Date.now();
const superAdmin: SessionUser = {
  uid: `e2e-super-${stamp}`,
  email: "e2e@bridge.test",
  displayName: "E2E Super",
  role: "super_admin",
  schoolId: null,
  status: "active",
};

async function main() {
  console.log("── Bridge integration test ──");

  // 1. Gemini connectivity (tiny call).
  const ping = await generateText({
    model: textModel(),
    prompt: "Reply with exactly: OK",
    maxOutputTokens: 200,
  });
  ok("Gemini ping", ping.text.trim().length > 0, `“${ping.text.trim().slice(0, 20)}”`);

  // 2. School + owner admin + student (real Auth users + Firestore docs).
  const { school, owner } = await createSchoolWithOwner(superAdmin, {
    schoolName: `E2E Test School ${stamp}`,
    ownerName: "E2E Owner",
    ownerEmail: `bridge-e2e-owner+${stamp}@example.com`,
    ownerPassword: "E2eTestPass123",
  });
  const adminSession: SessionUser = {
    uid: owner.id,
    email: owner.email,
    displayName: owner.displayName,
    role: "admin",
    schoolId: school.id,
    status: "active",
  };
  schoolIdCache = school.id;
  ownerIdCache = owner.id;
  ok("School + owner admin created", true, `school=${school.id}`);

  const student = await createStudent(adminSession, {
    displayName: "E2e Student",
    email: `bridge-e2e-student+${stamp}@example.com`,
    password: "E2eTestPass123",
    level: "secondary",
    secondarySubLevel: "a_level",
    classLevel: 5,
  });
  const studentSession: SessionUser = {
    uid: student.id,
    email: student.email,
    displayName: student.displayName,
    role: "student",
    schoolId: school.id,
    status: "active",
  };
  studentIdCache = student.id;
  ok(
    "A-level student created",
    student.level === "secondary" && student.secondarySubLevel === "a_level",
  );

  // 3. Wallet top-up.
  await topupWallet(superAdmin, { walletId: school.id, tokens: 300_000, description: "E2E top-up" });
  const walletBefore = (await walletDoc(school.id).get()).data()!;
  ok("Wallet topped up", walletBefore.balanceTokens === 300_000, "300,000 tokens");

  // 4. AI exam generation — A-level History with the African branch.
  const { exam, tokensUsed } = await generateExam(adminSession, {
    params: {
      subject: "history",
      level: "secondary",
      secondarySubLevel: "a_level",
      classLevel: 5,
      topic: "African nationalism and independence movements",
      subsidiary: "african_history",
      difficulty: "medium",
      durationMinutes: 20,
      questionCount: 5,
      questionTypes: ["multiple_choice", "essay"],
      includeHints: false,
      includeExplanations: true,
      includeWorkedExamples: false,
      instructions: null,
    },
    documentIds: [],
  });
  ok("AI exam generated", exam.questions.length === 5, `${tokensUsed.toLocaleString()} tokens`);
  ok(
    "Exam stored with sub-level + branch",
    exam.params.secondarySubLevel === "a_level" && exam.params.subsidiary === "african_history",
  );
  const walletAfterGen = (await walletDoc(school.id).get()).data()!;
  ok(
    "Wallet debited for generation",
    walletAfterGen.balanceTokens === 300_000 - tokensUsed,
    `balance=${walletAfterGen.balanceTokens.toLocaleString()}`,
  );
  const txs = await transactionsCol().where("walletId", "==", school.id).get();
  ok("Ledger transaction written", txs.size >= 2, `${txs.size} entries`);

  // 5. Assign + start; verify answers are stripped from the client payload.
  const created1 = await assignExam(adminSession, { examId: exam.id, studentIds: [student.id], scheduledFor: null });
  ok("Exam assigned", created1 === 1);
  const pending = (await attemptsCol().where("examId", "==", exam.id).limit(1).get()).docs[0]!;
  const attempt1Id = pending.id;

  const started = await startAttempt(studentSession, attempt1Id);
  ok("Attempt started", started.questions.length === 5, `deadline in ${Math.round((started.deadlineMs - Date.now()) / 60000)} min`);
  const leaked = started.questions.some(
    (q) => "correctOptionIndex" in q || "correctBool" in q || "acceptableAnswers" in q || "explanation" in q,
  );
  ok("Client questions leak no answers", !leaked);

  // 6. Proctoring: two warnings then termination.
  const v1 = await logProctorEvent(studentSession, attempt1Id, { type: "tab_switch", severity: "high", details: {}, aiVerdict: null });
  ok("First violation → warning", v1.action === "warn" && v1.warnings === 1);
  const v2 = await logProctorEvent(studentSession, attempt1Id, { type: "paste_attempt", severity: "high", details: {}, aiVerdict: null });
  ok("Second violation → warning", v2.action === "warn" && v2.warnings === 2);
  const v3 = await logProctorEvent(studentSession, attempt1Id, { type: "multiple_faces", severity: "critical", details: {}, aiVerdict: "Another person visible" });
  ok("Third violation → terminate", v3.action === "terminate");
  const flagged = (await attemptDoc(attempt1Id).get()).data()!;
  ok("Attempt flagged after cheating", flagged.status === "flagged");
  let submitBlocked = false;
  try {
    await submitAttempt(studentSession, attempt1Id, { answers: [], autoSubmitted: true, timeSpentSeconds: 60 });
  } catch {
    submitBlocked = true;
  }
  ok("Flagged attempt rejects submission", submitBlocked);

  // 7. Fresh attempt (retake of flagged): full submit + AI essay grading.
  const created2 = await assignExam(adminSession, { examId: exam.id, studentIds: [student.id], scheduledFor: null });
  ok("Re-assignment after flag creates fresh attempt", created2 === 1);
  const attempt2 = (
    await attemptsCol().where("examId", "==", exam.id).orderBy("createdAt", "desc").limit(1).get()
  ).docs[0]!;
  const attempt2Id = attempt2.id;
  ok("Retake links to the flagged attempt", attempt2.data()!.retakeOf === attempt1Id);

  const started2 = await startAttempt(studentSession, attempt2Id);
  const answers = started2.questions.map((q, i) => ({
    questionId: q.id,
    response: q.type === "multiple_choice" ? i % 4 : "Nationalism grew from anti-colonial grievances over land, taxation, and representation.",
  }));
  await attachRecordings(studentSession, attempt2Id, {
    cameraPath: `recordings/${attempt2Id}/camera.webm`,
    screenPath: `recordings/${attempt2Id}/screen.webm`,
  });
  const submitted = await submitAttempt(studentSession, attempt2Id, {
    answers,
    autoSubmitted: false,
    timeSpentSeconds: 600,
  });
  ok("Attempt submitted", submitted.status === "submitted" && submitted.needsAiGrading);

  await gradeAttemptWithAi(attempt2Id);
  const graded = (await attemptDoc(attempt2Id).get()).data()!;
  ok("AI grading finalized", graded.status === "graded", `${graded.score?.percentage}% score`);
  ok(
    "Feedback present",
    Boolean(graded.feedback?.overall && graded.feedback!.improvements.length > 0),
  );

  // 8. PDF report.
  const examFull = (await examDoc(exam.id).get()).data()!;
  const pdf = await renderAttemptReport(
    { id: attempt2Id, ...graded },
    { id: exam.id, ...examFull },
    { displayName: student.displayName, email: student.email },
  );
  ok("PDF report rendered", pdf.length > 1_000 && pdf.subarray(0, 4).toString() === "%PDF", `${Math.round(pdf.length / 1024)} KB`);

  console.log(`\nAll ${passed} integration checks passed ✅`);
}

async function cleanup() {
  const wipe = async () => {
    // Attempts, exams, transactions, wallet, school, users (docs + auth).
    const attemptDocs = await attemptsCol().where("studentId", "==", studentIdCache).get();
    for (const d of attemptDocs.docs) {
      const events = await adminDb().collection("proctoring_events").where("attemptId", "==", d.id).get();
      for (const e of events.docs) await e.ref.delete();
      await d.ref.delete();
    }
    const examDocs = await examsCol().where("schoolId", "==", schoolIdCache).get();
    for (const d of examDocs.docs) await d.ref.delete();
    const txDocs = await transactionsCol().where("walletId", "==", schoolIdCache).get();
    for (const d of txDocs.docs) await d.ref.delete();
    await walletDoc(schoolIdCache).delete();
    await schoolDoc(schoolIdCache).delete();
    await userDoc(studentIdCache).delete();
    await userDoc(ownerIdCache).delete();
    await usersCol().doc(superAdmin.uid).delete().catch(() => undefined);
    await adminAuth().deleteUser(studentIdCache).catch(() => undefined);
    await adminAuth().deleteUser(ownerIdCache).catch(() => undefined);
  };
  try {
    await wipe();
    console.log("🧹 Cleanup complete — test artifacts removed.");
  } catch (err) {
    console.error("⚠️ Cleanup incomplete:", err);
    console.error(`   Remove manually: school=${schoolIdCache} owner=${ownerIdCache} student=${studentIdCache}`);
  }
}

// Caches filled during main() so cleanup always knows what to remove.
let schoolIdCache = "";
let ownerIdCache = "";
let studentIdCache = "";

main()
  .catch((err) => {
    console.error("\n✗ Integration test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Discover ids even if main() failed partway.
    try {
      if (!schoolIdCache) {
        const snap = await schoolsCol().where("name", "==", `E2E Test School ${stamp}`).limit(1).get();
        schoolIdCache = snap.docs[0]?.id ?? "";
      }
      if (schoolIdCache) {
        const admins = await usersCol().where("schoolId", "==", schoolIdCache).get();
        ownerIdCache = admins.docs.find((d) => d.data()!.role === "admin")?.id ?? "";
        studentIdCache = admins.docs.find((d) => d.data()!.role === "student")?.id ?? "";
      }
    } catch {
      /* best effort */
    }
    await cleanup();
  });

export {};
