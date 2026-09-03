import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminDb: vi.fn(),
  attemptsCol: vi.fn(),
  classDoc: vi.fn(),
  examDoc: vi.fn(),
  usersCol: vi.fn(),
  writeAudit: vi.fn(),
  notifyUsers: vi.fn(),
  getExamForActor: vi.fn(),
}));

vi.mock("@/server/firebase/admin", () => ({ adminDb: mocks.adminDb }));
vi.mock("@/server/firebase/collections", () => ({
  attemptsCol: mocks.attemptsCol,
  classDoc: mocks.classDoc,
  examDoc: mocks.examDoc,
  usersCol: mocks.usersCol,
}));
vi.mock("@/server/services/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/server/services/notifications", () => ({ notifyUsers: mocks.notifyUsers }));
vi.mock("@/server/services/exams/library", () => ({
  getExamForActor: mocks.getExamForActor,
}));

import { assignExam } from "@/server/services/exams/assignment";
import { ExamsServiceError } from "@/server/services/exams/errors";
import type { SessionUser } from "@/server/auth/session";
import type { AttemptDoc, ExamDoc } from "@/types/firestore";

const actor: SessionUser = {
  uid: "admin-1",
  email: "admin@school.test",
  displayName: "Admin",
  role: "admin",
  schoolId: "school-1",
  status: "active",
};

function exam(expiresAt: Timestamp): ExamDoc {
  return {
    title: "Test exam",
    schoolId: "school-1",
    classId: "class-1",
    createdBy: "admin-1",
    status: "active",
    questions: [],
    expiresAt,
  } as unknown as ExamDoc;
}

function input(scheduledFor: string | null) {
  return {
    examId: "exam-1",
    studentIds: ["student-1"],
    scheduledFor,
    acknowledgeUnreviewed: false,
  };
}

function setup(preflight: ExamDoc, locked = preflight, existing: AttemptDoc[] = []) {
  const examRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => preflight }) };
  mocks.examDoc.mockReturnValue(examRef);

  const userQuery = {
    where: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: [{ id: "student-1" }] }),
  };
  userQuery.where.mockReturnValue(userQuery);
  mocks.usersCol.mockReturnValue(userQuery);

  const clauses: Array<[string, string, unknown]> = [];
  const attemptsQuery = {
    where: vi.fn((...clause: [string, string, unknown]) => {
      clauses.push(clause);
      return attemptsQuery;
    }),
    doc: vi.fn(() => ({ id: "new-attempt" })),
  };
  mocks.attemptsCol.mockReturnValue(attemptsQuery);

  const tx = {
    get: vi.fn(async (target: unknown) =>
      target === examRef
        ? { exists: true, data: () => locked }
        : { docs: existing.map((attempt) => ({ data: () => attempt })) },
    ),
    create: vi.fn(),
    update: vi.fn(),
  };
  const runTransaction = vi.fn(async (callback: (transaction: typeof tx) => unknown) =>
    callback(tx),
  );
  mocks.adminDb.mockReturnValue({ runTransaction });
  return { clauses, runTransaction, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAudit.mockResolvedValue(undefined);
});

async function assignmentError(promise: Promise<unknown>): Promise<ExamsServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExamsServiceError) return error;
    throw error;
  }
  throw new Error("Expected assignment to fail");
}

describe("assignExam scheduling", () => {
  it("rejects a schedule after the exam deadline before opening a transaction", async () => {
    const deadline = Timestamp.fromMillis(Date.now() + 60_000);
    const { runTransaction } = setup(exam(deadline));

    const error = await assignmentError(
      assignExam(actor, input(new Date(deadline.toMillis() + 1).toISOString())),
    );

    expect(error.status).toBe(400);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("accepts a past schedule that is still within the exam window", async () => {
    const { tx } = setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));

    await expect(assignExam(actor, input(new Date(Date.now() - 60_000).toISOString()))).resolves.toBe(1);
    expect(tx.create).toHaveBeenCalledOnce();
  });

  it("uses the locked deadline to reject a schedule before attempt writes", async () => {
    const scheduled = Date.now() + 30_000;
    const { tx } = setup(
      exam(Timestamp.fromMillis(scheduled + 60_000)),
      exam(Timestamp.fromMillis(scheduled - 1)),
    );

    const error = await assignmentError(assignExam(actor, input(new Date(scheduled).toISOString())));
    expect(error.status).toBe(400);
    expect(tx.create).not.toHaveBeenCalled();
  });

  it("aborts when the locked exam expires after preflight", async () => {
    const { tx } = setup(
      exam(Timestamp.fromMillis(Date.now() + 60_000)),
      exam(Timestamp.fromMillis(Date.now() - 1)),
    );

    const error = await assignmentError(assignExam(actor, input(null)));
    expect(error.status).toBe(409);
    expect(tx.create).not.toHaveBeenCalled();
  });
});

describe("assignExam existing attempts", () => {
  it("queries by exam and student only, then filters open statuses in memory", async () => {
    const closedAttempt = {
      studentId: "student-1",
      status: "graded",
    } as AttemptDoc;
    const { clauses, tx } = setup(
      exam(Timestamp.fromMillis(Date.now() + 60_000)),
      undefined,
      [closedAttempt],
    );

    await expect(assignExam(actor, input(null))).resolves.toBe(1);
    expect(clauses.map(([field]) => field)).toEqual(["examId", "studentId"]);
    expect(tx.create).toHaveBeenCalledOnce();
  });
});
