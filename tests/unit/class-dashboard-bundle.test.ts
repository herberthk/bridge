import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClassForActor, fetchClassStudents, countClassStudents } = vi.hoisted(() => ({
  getClassForActor: vi.fn(),
  fetchClassStudents: vi.fn(),
  countClassStudents: vi.fn(),
}));



const { attemptsCol, examDoc } = vi.hoisted(() => ({
  attemptsCol: vi.fn(),
  examDoc: vi.fn(),
}));

vi.mock("@/server/services/classes", () => ({
  getClassForActor,
  fetchClassStudents,
  countClassStudents,
  // Const mirrored from the service — the at-cap test below pins the pairing.
  CLASS_ROSTER_LIMIT: 500,
}));

vi.mock("@/server/firebase/collections", () => ({
  attemptsCol,
  examDoc,
  // Present so the service module still links; the bundle path never
  // touches them (roster reads go through the mocked service above).
  classDoc: vi.fn(),
  userDoc: vi.fn(),
  usersCol: vi.fn(),
}));

import { getClassDashboardBundle } from "@/server/services/leaderboard";
import type { SessionUser } from "@/server/auth/session";

const actor: SessionUser = {
  uid: "teacher-1",
  email: "teacher@school.test",
  displayName: "Teacher",
  role: "teacher",
  schoolId: "school-1",
  status: "active",
};

const cls = { id: "class-1", name: "Senior 1", teacherIds: ["teacher-1"], studentCount: 2 };

const students = [
  { id: "s-1", displayName: "Ann" },
  { id: "s-2", displayName: "Bob" },
];

function attempt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studentId: "s-1",
    examId: "e-1",
    status: "submitted",
    score: null,
    submittedAt: { toMillis: () => 1 },
    ...overrides,
  };
}

function attemptsGet(docs: Array<Record<string, unknown>>) {
  return vi.fn().mockResolvedValue({
    docs: docs.map((data, i) => ({ id: `a-${i}`, data: () => data })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getClassForActor.mockResolvedValue(cls);
  fetchClassStudents.mockResolvedValue(students);
  countClassStudents.mockResolvedValue(0);
  examDoc.mockReturnValue({
    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ title: "Paper 1" }) }),
  });
});

function mockAttemptsFanOut(get: ReturnType<typeof vi.fn>) {
  attemptsCol.mockReturnValue({
    where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get }) }),
  });
  return get;
}

describe("getClassDashboardBundle", () => {
  it("shares one roster read and one attempts fan-out across all widgets", async () => {
    const get = mockAttemptsFanOut(
      attemptsGet([
        attempt({ studentId: "s-1", status: "graded", score: { earned: 8, possible: 10, percentage: 80 } }),
        attempt({ studentId: "s-1", status: "graded", score: { earned: 6, possible: 10, percentage: 60 } }),
        attempt({ studentId: "s-2" }),
      ]),
    );

    const bundle = await getClassDashboardBundle(actor, "class-1");

    expect(fetchClassStudents).toHaveBeenCalledTimes(1);
    expect(fetchClassStudents).toHaveBeenCalledWith("class-1");
    expect(get).toHaveBeenCalledTimes(1);
    expect(bundle.cls).toBe(cls);
    expect(bundle.students).toBe(students);
    expect(bundle.leaderboard?.entries).toHaveLength(2);
    expect(bundle.leaderboard?.stats.students).toBe(2);
    expect(bundle.performance).toHaveLength(1);
    expect(bundle.performance[0]).toMatchObject({
      examId: "e-1",
      title: "Paper 1",
      attemptsTaken: 3,
      gradedCount: 2,
      averagePercentage: 70,
    });
    expect(bundle.degraded).toEqual([]);
    // Under the cap the list length is already exact — no aggregation needed.
    expect(bundle.studentCount).toBe(2);
    expect(countClassStudents).not.toHaveBeenCalled();
  });

  it("uses the exact headcount when the roster list hits its cap", async () => {
    const capped = Array.from({ length: 500 }, (_, i) => ({
      id: `s-${i}`,
      displayName: `Student ${i}`,
    }));
    fetchClassStudents.mockResolvedValue(capped);
    countClassStudents.mockResolvedValue(600);
    mockAttemptsFanOut(attemptsGet([]));

    const bundle = await getClassDashboardBundle(actor, "class-1");

    expect(countClassStudents).toHaveBeenCalledTimes(1);
    expect(countClassStudents).toHaveBeenCalledWith("class-1");
    expect(bundle.studentCount).toBe(600);
    expect(bundle.leaderboard?.stats.students).toBe(600);
  });

  it("skips the fan-out entirely for an empty roster", async () => {
    fetchClassStudents.mockResolvedValue([]);
    const get = mockAttemptsFanOut(attemptsGet([]));

    const bundle = await getClassDashboardBundle(actor, "class-1");

    expect(bundle.students).toEqual([]);
    expect(bundle.leaderboard?.entries).toEqual([]);
    expect(bundle.performance).toEqual([]);
    expect(bundle.degraded).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("fails loud when the roster read fails", async () => {
    fetchClassStudents.mockRejectedValue(new Error("index missing"));

    await expect(getClassDashboardBundle(actor, "class-1")).rejects.toThrow("index missing");
  });

  it("degrades both widgets when the attempts fan-out fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockAttemptsFanOut(vi.fn().mockRejectedValue(new Error("unavailable")));

    const bundle = await getClassDashboardBundle(actor, "class-1");

    expect(bundle.students).toBe(students);
    expect(bundle.leaderboard).toBeNull();
    expect(bundle.performance).toEqual([]);
    expect(bundle.degraded).toEqual(["Leaderboard", "Performance"]);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("propagates auth errors for the page to map to 404", async () => {
    getClassForActor.mockRejectedValue(new Error("not assigned"));

    await expect(getClassDashboardBundle(actor, "class-1")).rejects.toThrow("not assigned");
    expect(fetchClassStudents).not.toHaveBeenCalled();
  });
});
