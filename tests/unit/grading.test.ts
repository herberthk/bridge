import { describe, expect, it } from "vitest";

import { gradeOne, gradeAnswers } from "@/server/services/attempts";
import { normalizeAnswer } from "@/lib/schemas/attempt";
import type { Question } from "@/types/firestore";

const base: Question = {
  id: "q1",
  type: "multiple_choice",
  prompt: "2 + 2?",
  options: ["3", "4", "5", "6"],
  correctOptionIndex: 1,
  correctBool: null,
  acceptableAnswers: null,
  pairs: null,
  points: 1,
  hint: null,
  explanation: null,
  workedExample: null,
};

describe("grading: multiple choice", () => {
  it("awards full marks on the correct index", () => {
    const g = gradeOne(base, 1)!;
    expect(g.correct).toBe(true);
    expect(g.earned).toBe(1);
    expect(g.possible).toBe(1);
  });

  it("awards zero on a wrong index", () => {
    const g = gradeOne(base, 0)!;
    expect(g.correct).toBe(false);
    expect(g.earned).toBe(0);
  });

  it("returns null (AI-graded) when the key is missing", () => {
    expect(gradeOne({ ...base, correctOptionIndex: null }, 1)).toBeNull();
  });
});

describe("grading: true/false", () => {
  const q: Question = { ...base, type: "true_false", correctBool: true };
  it("matches booleans", () => {
    expect(gradeOne(q, true)!.correct).toBe(true);
    expect(gradeOne(q, false)!.correct).toBe(false);
  });
});

describe("grading: fill in the blank / short answer", () => {
  it("normalizes case and spacing", () => {
    const q: Question = {
      ...base,
      type: "short_answer",
      acceptableAnswers: ["Kampala"],
    };
    expect(gradeOne(q, "kampala")!.correct).toBe(true);
    expect(gradeOne(q, "  KAMPALA  ")!.correct).toBe(true);
    expect(gradeOne(q, "Entebbe")!.correct).toBe(false);
  });

  it("accepts pipe-separated variants per blank", () => {
    const q: Question = {
      ...base,
      type: "fill_in_the_blank",
      acceptableAnswers: ["heat|thermal energy", "celsius|°C"],
    };
    expect(gradeOne(q, ["thermal energy", "°C"])!.correct).toBe(true);
    expect(gradeOne(q, ["thermal energy", "fahrenheit"])!.correct).toBe(false);
  });

  it("requires every blank to match", () => {
    const q: Question = {
      ...base,
      type: "fill_in_the_blank",
      acceptableAnswers: ["a", "b"],
    };
    expect(gradeOne(q, ["a"])!.correct).toBe(false);
  });
});

describe("grading: matching", () => {
  const q: Question = {
    ...base,
    type: "matching",
    pairs: [
      { left: "H₂O", right: "Water" },
      { left: "NaCl", right: "Salt" },
    ],
    points: 2,
  };
  it("awards full marks when every pair matches (case-insensitive)", () => {
    const g = gradeOne(q, ["water", "salt"])!;
    expect(g.correct).toBe(true);
    expect(g.earned).toBe(2);
  });
  it("awards zero when any pair is wrong", () => {
    expect(gradeOne(q, ["water", "sugar"])!.correct).toBe(false);
    expect(gradeOne(q, ["water"])!.correct).toBe(false);
  });
});

describe("grading: essays defer to AI", () => {
  it("returns null for non-empty essay responses", () => {
    const q: Question = { ...base, type: "essay", points: 10 };
    expect(gradeOne(q, "My long answer…")).toBeNull();
  });
});

describe("grading: full attempt assembly", () => {
  it("keeps order aligned with questions and grades submitted answers", () => {
    const questions: Question[] = [
      base,
      { ...base, id: "q2", type: "true_false", correctBool: false },
      { ...base, id: "q3", type: "essay" },
    ];
    const answers = gradeAnswers(questions, [
      { questionId: "q1", response: 1 },
      { questionId: "q2", response: true }, // wrong
      // q3 unanswered
    ]);
    expect(answers.map((a) => a.questionId)).toEqual(["q1", "q2", "q3"]);
    expect(answers[0].graded!.earned).toBe(1);
    expect(answers[1].graded!.earned).toBe(0);
    expect(answers[2].graded).toBeNull();
    expect(answers[2].response).toBeNull();
  });
});

describe("normalizeAnswer", () => {
  it("lowercases, collapses spaces, and strips trailing punctuation/quotes", () => {
    expect(normalizeAnswer("  The   Answer. ")).toBe("the answer");
    expect(normalizeAnswer("“Kampala”")).toBe('"kampala"');
  });
});
