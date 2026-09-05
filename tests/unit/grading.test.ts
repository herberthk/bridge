import { describe, expect, it } from "vitest";

import { gradeOne, gradeAnswers, hasAnswer, summarizeScore, applyAiGrades } from "@/server/services/attempts";
import { normalizeAnswer } from "@/lib/schemas/attempt";
import type { AttemptAnswer, Question } from "@/types/firestore";

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

describe("hasAnswer", () => {
  it("rejects null, undefined, and empty strings", () => {
    expect(hasAnswer(null)).toBe(false);
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer("")).toBe(false);
  });
  it("treats blank strings as unanswered so they skip AI grading", () => {
    expect(hasAnswer("   ")).toBe(false);
    expect(hasAnswer("My answer")).toBe(true);
  });
  it("treats untouched per-slot arrays as unanswered", () => {
    expect(hasAnswer([])).toBe(false);
    expect(hasAnswer(["", null, "  "])).toBe(false);
    expect(hasAnswer(["", "Paris"])).toBe(true);
  });
  it("accepts numbers and booleans (objective responses)", () => {
    expect(hasAnswer(0)).toBe(true);
    expect(hasAnswer(false)).toBe(true);
  });
});

function stored(
  questionId: string,
  earned: number | null,
  possible: number,
  correct: boolean | null = earned !== null && earned >= possible,
): AttemptAnswer {
  return {
    questionId,
    type: "essay",
    response: "answer",
    graded:
      earned === null ? null : { earned, possible, correct, feedback: null },
  };
}

describe("summarizeScore", () => {
  const points = [{ points: 5 }, { points: 5 }, { points: 10 }, { points: 10 }, { points: 10 }];
  it("sums earned over paper possible, counting partial credit and skipping blanks", () => {
    // 5 + 0 + 10 + 7 + ungraded = 22/40 → 55%
    const answers = [
      stored("q1", 5, 5),
      stored("q2", 0, 5),
      stored("q3", 10, 10),
      stored("q4", 7, 10),
      stored("q5", null, 10),
    ];
    expect(summarizeScore(answers, points)).toEqual({ earned: 22, possible: 40, percentage: 55 });
  });
  it("rounds half-up", () => {
    expect(summarizeScore([stored("q1", 2, 3)], [{ points: 3 }]).percentage).toBe(67);
    expect(summarizeScore([stored("q1", 1, 3)], [{ points: 3 }]).percentage).toBe(33);
  });
  it("returns zeros when the paper carries no marks", () => {
    expect(summarizeScore([stored("q1", 0, 0)], [{ points: 0 }])).toEqual({
      earned: 0,
      possible: 0,
      percentage: 0,
    });
  });
});

describe("applyAiGrades", () => {
  const paper = [{ id: "q4", points: 10 }];
  const pending: AttemptAnswer[] = [
    { questionId: "q4", type: "essay", response: "My essay", graded: null },
  ];
  it("merges a full-marks grade", () => {
    const [a] = applyAiGrades(pending, [{ questionId: "q4", earned: 10, possible: 10, feedback: "Great" }], paper);
    expect(a!.graded).toMatchObject({ earned: 10, possible: 10, correct: true });
  });
  it("keeps partial credit on the failed side", () => {
    const [a] = applyAiGrades(pending, [{ questionId: "q4", earned: 7, possible: 10, feedback: "Ok" }], paper);
    expect(a!.graded).toMatchObject({ earned: 7, possible: 10, correct: false });
  });
  it("normalizes a deviant model possible to the paper and clamps earned", () => {
    const [a] = applyAiGrades(pending, [{ questionId: "q4", earned: 12, possible: 8, feedback: "x" }], paper);
    expect(a!.graded).toMatchObject({ earned: 10, possible: 10, correct: true });
    const [b] = applyAiGrades(pending, [{ questionId: "q4", earned: 7, possible: 8, feedback: "x" }], paper);
    expect(b!.graded).toMatchObject({ earned: 7, possible: 10, correct: false });
  });
  it("ignores grades for unknown questions and leaves other answers untouched", () => {
    const objective: AttemptAnswer = {
      questionId: "q1",
      type: "multiple_choice",
      response: 1,
      graded: { earned: 5, possible: 5, correct: true, feedback: null },
    };
    const out = applyAiGrades(
      [objective, ...pending],
      [{ questionId: "ghost", earned: 5, possible: 5, feedback: "x" }],
      [...paper, { id: "q1", points: 5 }],
    );
    expect(out[0]).toBe(objective);
    expect(out[1]!.graded).toBeNull();
  });
});
