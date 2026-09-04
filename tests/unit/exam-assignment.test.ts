import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminDb: vi.fn(),
  attemptsCol: vi.fn(),
  classDoc: vi.fn(),
  examDoc: vi.fn(),
  userDoc: vi.fn(),
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
  userDoc: mocks.userDoc,
  usersCol: mocks.usersCol,
}));
vi.mock("@/server/services/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/server/services/notifications", () => ({ notifyUsers: mocks.notifyUsers }));
vi.mock("@/server/services/exams/library", () => ({
  getExamForActor: mocks.getExamForActor,
}));

import { assignExam, unassignExam } from "@/server/services/exams/assignment";
import { ExamsServiceError } from "@/server/services/exams/errors";
import { MAX_UNASSIGN_STUDENTS } from "@/lib/schemas/exam";
import type { SessionUser } from "@/server/auth/session";
import type { AttemptDoc, ExamDoc, UserDoc } from "@/types/firestore";

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

function student(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    role: "student",
    schoolId: "school-1",
    classId: "class-1",
    createdBy: "admin-1",
    ...overrides,
  } as UserDoc;
}

function setup(
  preflight: ExamDoc,
  locked = preflight,
  existing: AttemptDoc[] = [],
  allowedIds: string[] = ["student-1"],
  lockedStudentOverrides: Record<string, Partial<UserDoc> | null> = {},
) {
  const examRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => preflight }) };
  mocks.examDoc.mockReturnValue(examRef);

  const userQuery = {
    where: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs: allowedIds.map((id) => ({ id })) }),
  };
  userQuery.where.mockReturnValue(userQuery);
  mocks.usersCol.mockReturnValue(userQuery);

  const userRefs = new Map<string, { kind: "user"; id: string }>();
  mocks.userDoc.mockImplementation((id: string) => {
    const existingRef = userRefs.get(id);
    if (existingRef) return existingRef;
    const ref = { kind: "user" as const, id };
    userRefs.set(id, ref);
    return ref;
  });

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
    get: vi.fn(
      async (
        target: unknown,
      ): Promise<
        | { exists: boolean; data: () => unknown }
        | { docs: { ref: { id: string }; data: () => AttemptDoc }[] }
      > =>
        target === examRef
          ? { exists: true, data: () => locked }
          : (target as { kind?: string }).kind === "user"
            ? lockedStudentOverrides[(target as { id: string }).id] === null
              ? { exists: false, data: () => undefined }
              : {
                  exists: true,
                  data: () =>
                    student(lockedStudentOverrides[(target as { id: string }).id] ?? {}),
                }
          : {
              docs: existing.map((attempt, i) => ({
                ref: { id: `attempt-${i}` },
                data: () => attempt,
              })),
            },
    ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

describe("assignExam class scope", () => {
  it("constrains the student lookup to the exam's class for admins", async () => {
    setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));

    await expect(assignExam(actor, input(null))).resolves.toBe(1);
    const userQuery = mocks.usersCol.mock.results[0]?.value as {
      where: ReturnType<typeof vi.fn>;
    };
    expect(userQuery.where).toHaveBeenCalledWith("classId", "==", "class-1");
  });

  it("rejects students outside the exam's class for admins", async () => {
    setup(
      exam(Timestamp.fromMillis(Date.now() + 60_000)),
      undefined,
      [],
      [],
    );

    const error = await assignmentError(assignExam(actor, input(null)));

    expect(error.status).toBe(403);
    expect(error.message).toContain("not in this exam's class");
  });

  it("keeps only the school check for class-less legacy exams", async () => {
    const legacy = { ...exam(Timestamp.fromMillis(Date.now() + 60_000)), classId: null };
    setup(legacy);

    await expect(assignExam(actor, input(null))).resolves.toBe(1);
    const userQuery = mocks.usersCol.mock.results[0]?.value as {
      where: ReturnType<typeof vi.fn>;
    };
    const fields = userQuery.where.mock.calls.map(([field]) => field);
    expect(fields).not.toContain("classId");
  });

  it("rejects a student whose role changes after preflight", async () => {
    const { tx } = setup(
      exam(Timestamp.fromMillis(Date.now() + 60_000)),
      undefined,
      [],
      ["student-1"],
      { "student-1": { role: "teacher" } },
    );

    const error = await assignmentError(assignExam(actor, input(null)));

    expect(error.status).toBe(403);
    expect(tx.create).not.toHaveBeenCalled();
  });
});

describe("assignExam teacher class membership", () => {
  const teacher: SessionUser = {
    ...actor,
    uid: "teacher-1",
    email: "teacher@school.test",
    displayName: "Teacher",
    role: "teacher",
  };

  it("aborts when the teacher is unassigned from the class mid-flight", async () => {
    const { tx } = setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));
    // Preflight still sees the teacher on the class…
    const classRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ schoolId: "school-1", teacherIds: ["teacher-1"] }),
      })),
    };
    mocks.classDoc.mockReturnValue(classRef);
    // …but by commit time the admin has removed them.
    const originalGet = tx.get.getMockImplementation();
    if (!originalGet) throw new Error("test setup broken");
    tx.get.mockImplementation(async (target: unknown) => {
      if (target === classRef) {
        return {
          exists: true,
          data: () => ({ schoolId: "school-1", teacherIds: [] }),
        };
      }
      return originalGet(target);
    });

    const error = await assignmentError(assignExam(teacher, input(null)));

    expect(error.status).toBe(403);
    expect(error.message).toContain("not assigned to this exam's class");
    expect(tx.create).not.toHaveBeenCalled();
  });
});

describe("unassignExam", () => {
  const uinput = (ids: string[]) => ({ examId: "exam-1", studentIds: ids });
  const pending = (studentId: string) =>
    ({ studentId, status: "pending" }) as AttemptDoc;
  const started = (studentId: string) =>
    ({ studentId, status: "in_progress" }) as AttemptDoc;

  it("deletes pending attempts and skips started ones", async () => {
    const { tx } = setup(
      exam(Timestamp.fromMillis(Date.now() + 60_000)),
      undefined,
      [pending("student-1"), started("student-2")],
      ["student-1", "student-2"],
    );

    const result = await unassignExam(actor, uinput(["student-1", "student-2"]));

    expect(result).toEqual({ removedIds: ["student-1"], skippedIds: ["student-2"] });
    expect(tx.delete).toHaveBeenCalledOnce();
  });

  it("rejects students outside the exam's class", async () => {
    setup(exam(Timestamp.fromMillis(Date.now() + 60_000)), undefined, [], []);

    const error = await assignmentError(unassignExam(actor, uinput(["student-1"])));

    expect(error.status).toBe(403);
    expect(error.message).toContain("not in this exam's class");
  });

  it.each([
    ["role", { role: "teacher" }],
    ["school", { schoolId: "school-2" }],
    ["class", { classId: "class-2" }],
  ] satisfies Array<[string, Partial<UserDoc>]>)
    ("rejects a student whose %s changes after preflight", async (_field, overrides) => {
      const { tx } = setup(
        exam(Timestamp.fromMillis(Date.now() + 60_000)),
        undefined,
        [pending("student-1")],
        ["student-1"],
        { "student-1": overrides },
      );

      const error = await assignmentError(unassignExam(actor, uinput(["student-1"])));

      expect(error.status).toBe(403);
      expect(tx.delete).not.toHaveBeenCalled();
    });

  it("rejects a teacher who is not assigned to the exam's class", async () => {
    setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));
    mocks.classDoc.mockReturnValue({
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ schoolId: "school-1", teacherIds: ["teacher-9"] }),
      })),
    });
    const teacher: SessionUser = {
      ...actor,
      uid: "teacher-1",
      email: "teacher@school.test",
      displayName: "Teacher",
      role: "teacher",
    };

    const error = await assignmentError(unassignExam(teacher, uinput(["student-1"])));

    expect(error.status).toBe(403);
    expect(error.message).toContain("not assigned to this exam's class");
  });

  it("rejects an empty selection", async () => {
    setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));

    const error = await assignmentError(unassignExam(actor, uinput([])));

    expect(error.status).toBe(400);
  });

  it("rejects selections too large for one bounded transaction", async () => {
    const { runTransaction } = setup(exam(Timestamp.fromMillis(Date.now() + 60_000)));
    const ids = Array.from(
      { length: MAX_UNASSIGN_STUDENTS + 1 },
      (_, index) => `student-${index}`,
    );

    const error = await assignmentError(unassignExam(actor, uinput(ids)));

    expect(error.status).toBe(400);
    expect(error.message).toContain(`no more than ${MAX_UNASSIGN_STUDENTS}`);
    expect(runTransaction).not.toHaveBeenCalled();
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
