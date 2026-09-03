import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attemptDoc: vi.fn(),
  classDoc: vi.fn(),
  classesBySchool: vi.fn(),
  countQuery: vi.fn(),
  examDoc: vi.fn(),
  examsCol: vi.fn(),
}));

vi.mock("@/server/firebase/collections", () => mocks);

import {
  countExams,
  getAttemptForActor,
  getExamForActor,
  listExams,
} from "@/server/services/exams/library";
import { ExamsServiceError } from "@/server/services/exams/errors";
import type { SessionUser } from "@/server/auth/session";
import type { ExamDoc } from "@/types/firestore";

const teacher: SessionUser = {
  uid: "teacher-1",
  email: "teacher@school.test",
  displayName: "Teacher",
  role: "teacher",
  schoolId: "school-1",
  status: "active",
};

const admin: SessionUser = { ...teacher, uid: "admin-1", role: "admin" };

function exam(classId: string | null): ExamDoc {
  return {
    classId,
    schoolId: "school-1",
    createdBy: "admin-1",
    createdAt: { toMillis: () => 0 } as ExamDoc["createdAt"],
    updatedAt: { toMillis: () => 0 } as ExamDoc["updatedAt"],
  } as ExamDoc;
}

function examSnapshot(id: string, data: ExamDoc) {
  return { id, data: () => data, createTime: {}, updateTime: {} };
}

function setupExamQuery(exams: Array<{ id: string; data: ExamDoc }>) {
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    get: vi.fn().mockResolvedValue({
      docs: exams.map(({ id, data }) => examSnapshot(id, data)),
    }),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.select.mockReturnValue(query);
  mocks.examsCol.mockReturnValue(query);
  return query;
}

function setupClasses() {
  mocks.classesBySchool.mockReturnValue({
    get: vi.fn().mockResolvedValue({
      docs: [
        { id: "assigned", data: () => ({ teacherIds: ["teacher-1"] }) },
        { id: "other", data: () => ({ teacherIds: ["teacher-2"] }) },
      ],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupClasses();
  mocks.countQuery.mockResolvedValue(1);
});

async function accessError(promise: Promise<unknown>): Promise<ExamsServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExamsServiceError) return error;
    throw error;
  }
  throw new Error("Expected access to be denied");
}

describe("teacher exam library scope", () => {
  it("returns and counts only exams for currently assigned classes", async () => {
    setupExamQuery([
      { id: "mine", data: exam("assigned") },
      { id: "theirs", data: exam("other") },
      { id: "unscoped", data: exam(null) },
    ]);

    const [listed, count] = await Promise.all([listExams(teacher), countExams(teacher)]);
    expect(listed.exams.map((item) => item.id)).toEqual(["mine"]);
    expect(count).toBe(1);
    expect(mocks.countQuery).toHaveBeenCalledOnce();
  });

  it("checks the resolved class for direct teacher access", async () => {
    mocks.examDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: true, id: "exam-1", data: () => exam("other") }),
    });
    mocks.classDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ schoolId: "school-1", teacherIds: ["teacher-2"] }),
      }),
    });

    const error = await accessError(getExamForActor(teacher, "exam-1"));
    expect(error.status).toBe(403);
  });

  it("preserves school-wide admin access without resolving the class", async () => {
    mocks.examDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: true, id: "exam-1", data: () => exam("other") }),
    });

    await expect(getExamForActor(admin, "exam-1")).resolves.toMatchObject({ id: "exam-1" });
    expect(mocks.classDoc).not.toHaveBeenCalled();
  });

  it("denies a teacher an attempt for an unassigned exam", async () => {
    mocks.attemptDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: "attempt-1",
        data: () => ({ examId: "exam-1", studentId: "student-1", schoolId: "school-1" }),
      }),
    });
    mocks.examDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: true, id: "exam-1", data: () => exam("other") }),
    });
    mocks.classDoc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ schoolId: "school-1", teacherIds: ["teacher-2"] }),
      }),
    });

    const error = await accessError(getAttemptForActor(teacher, "attempt-1"));
    expect(error.status).toBe(403);
  });
});
