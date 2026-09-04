import { describe, expect, it } from "vitest";

import { isStudentInExamScope } from "@/lib/exam/assignment-scope";

const exam = {
  classId: "class-s1a",
  params: { level: "secondary", classLevel: 1 },
} as const;

const student = {
  id: "student-1",
  classId: "class-s1a",
  level: "secondary",
  classLevel: 1,
} as const;

describe("isStudentInExamScope", () => {
  it("admits students of the exam's exact class", () => {
    expect(isStudentInExamScope(student, exam)).toBe(true);
  });

  it("rejects students of a different stream in the same grade", () => {
    expect(
      isStudentInExamScope({ ...student, classId: "class-s1b" }, exam),
    ).toBe(false);
  });

  it("rejects students of a different grade", () => {
    expect(
      isStudentInExamScope(
        { ...student, classId: "class-s2a", level: "secondary", classLevel: 2 },
        exam,
      ),
    ).toBe(false);
  });

  it("rejects students with no class", () => {
    expect(isStudentInExamScope({ ...student, classId: null }, exam)).toBe(false);
  });

  it("keeps already-assigned students visible even out of scope", () => {
    expect(
      isStudentInExamScope(
        { ...student, classId: "class-s2a" },
        exam,
        new Set(["student-1"]),
      ),
    ).toBe(true);
    expect(
      isStudentInExamScope(
        { ...student, classId: "class-s2a" },
        exam,
        ["student-1"],
      ),
    ).toBe(true);
  });

  it("falls back to grade level for class-less legacy exams", () => {
    const legacy = { classId: null, params: exam.params };
    expect(isStudentInExamScope({ ...student, classId: null }, legacy)).toBe(true);
    expect(
      isStudentInExamScope({ ...student, classLevel: 2 }, legacy),
    ).toBe(false);
  });
});
