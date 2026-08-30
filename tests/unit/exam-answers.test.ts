import { describe, expect, it } from "vitest";

import { answerMarkdown, correctMarkdown, type AnswerKeyQuestion } from "@/lib/exam/answers";

/**
 * The results review is the only screen where a student sees the answer key, and
 * every value on it is derived rather than stored: a multiple-choice response is
 * an index, a matching answer is a pair list, a fill-in-the-blank answer is an
 * array of per-slot strings. Letter arithmetic and array emptiness are both places
 * a defect shows up as a confidently-wrong answer rather than a crash.
 */

const q = (overrides: Partial<AnswerKeyQuestion> = {}): AnswerKeyQuestion => ({
  type: "multiple_choice",
  options: null,
  correctOptionIndex: null,
  correctBool: null,
  acceptableAnswers: null,
  pairs: null,
  ...overrides,
});

const OPTIONS = [
  String.raw`$\frac{9}{5}$`,
  String.raw`$\frac{6}{5}$`,
  String.raw`$\frac{13}{5}$`,
  String.raw`$\frac{4}{5}$`,
];

describe("answerMarkdown", () => {
  it("resolves a multiple-choice index to its letter and option text", () => {
    // Printing the bare letter left the review saying "B" beside a correct answer
    // written out in full — the student had to go back to the prompt to see what
    // they had picked.
    expect(answerMarkdown(1, q({ options: OPTIONS }))).toBe(String.raw`B. $\frac{6}{5}$`);
    expect(answerMarkdown(0, q({ options: OPTIONS }))).toBe(String.raw`A. $\frac{9}{5}$`);
    expect(answerMarkdown(3, q({ options: OPTIONS }))).toBe(String.raw`D. $\frac{4}{5}$`);
  });

  it("falls back to the letter when the option text is missing", () => {
    expect(answerMarkdown(2, q({ options: null }))).toBe("C");
    expect(answerMarkdown(2, q({ options: ["A only", "B only"] }))).toBe("C");
    expect(answerMarkdown(1, q({ options: ["kept", "   "] }))).toBe("B");
  });

  it("rejects an index that cannot be a letter", () => {
    expect(answerMarkdown(-1, q({ options: OPTIONS }))).toBeNull();
    expect(answerMarkdown(26, q({ options: OPTIONS }))).toBeNull();
    expect(answerMarkdown(1.5, q({ options: OPTIONS }))).toBeNull();
  });

  it("does not interpret numeric non-choice responses as option indexes", () => {
    expect(answerMarkdown(2, q({ type: "short_answer" }))).toBe("2");
  });

  it("spells out a boolean response", () => {
    expect(answerMarkdown(true, q({ type: "true_false" }))).toBe("True");
    // `false` is an answer, not an absence — a truthiness check reported it as blank.
    expect(answerMarkdown(false, q({ type: "true_false" }))).toBe("False");
  });

  it("joins the filled slots of a multi-part answer", () => {
    expect(answerMarkdown(["8", "cm"], q({ type: "fill_in_the_blank" }))).toBe("8, cm");
    expect(answerMarkdown([" 8 ", "", "cm"], q({ type: "fill_in_the_blank" }))).toBe(
      "8, cm",
    );
  });

  it("treats an untouched multi-part answer as unattempted", () => {
    // Fill-in-the-blank and matching answers are seeded as arrays of empty strings,
    // so an array is only an answer once something lands in it.
    expect(answerMarkdown(["", ""], q({ type: "fill_in_the_blank" }))).toBeNull();
    expect(answerMarkdown([], q({ type: "fill_in_the_blank" }))).toBeNull();
    expect(answerMarkdown([null, undefined], q({ type: "fill_in_the_blank" }))).toBeNull();
  });

  it("treats blank, null and undefined as unattempted", () => {
    expect(answerMarkdown("", q({ type: "short_answer" }))).toBeNull();
    expect(answerMarkdown("   ", q({ type: "short_answer" }))).toBeNull();
    expect(answerMarkdown(null, q({ type: "short_answer" }))).toBeNull();
    expect(answerMarkdown(undefined, q({ type: "short_answer" }))).toBeNull();
  });

  it("passes typed text through, trimmed and unformatted", () => {
    // Typed answers are string-matched against `acceptableAnswers`, which the
    // generator is told to keep plain — so nothing should be added here either.
    expect(answerMarkdown("  1.2  ", q({ type: "short_answer" }))).toBe("1.2");
    expect(answerMarkdown("kx(2-x)", q({ type: "short_answer" }))).toBe("kx(2-x)");
  });
});

describe("correctMarkdown", () => {
  it("renders the multiple-choice key with its letter", () => {
    const question = q({ options: OPTIONS, correctOptionIndex: 2 });
    expect(correctMarkdown(question)).toBe(String.raw`C. $\frac{13}{5}$`);
  });

  it("renders both true/false verdicts", () => {
    expect(correctMarkdown(q({ type: "true_false", correctBool: true }))).toBe("True");
    expect(correctMarkdown(q({ type: "true_false", correctBool: false }))).toBe("False");
  });

  it("shows matching pairs as mappings, not a bare right-hand list", () => {
    // The review used to print only the right column, which told a student the set
    // of answers but not which left item each belonged to.
    const question = q({
      type: "matching",
      pairs: [
        { left: "Mean", right: String.raw`$\bar{x}$` },
        { left: "Variance", right: String.raw`$\sigma^{2}$` },
      ],
    });
    expect(correctMarkdown(question)).toBe(
      String.raw`Mean → $\bar{x}$; Variance → $\sigma^{2}$`,
    );
  });

  it("drops a half-written pair rather than rendering a dangling arrow", () => {
    const question = q({
      type: "matching",
      pairs: [
        { left: "Mean", right: "average" },
        { left: "", right: "orphan" },
      ],
    });
    expect(correctMarkdown(question)).toBe("Mean → average");
  });

  it("joins acceptable answers for the typed types", () => {
    for (const type of ["short_answer", "fill_in_the_blank"] as const) {
      const question = q({ type, acceptableAnswers: ["1.2", " 6/5 ", ""] });
      expect(correctMarkdown(question)).toBe("1.2 / 6/5");
    }
  });

  it("returns null where there is no key to show", () => {
    // Essays are marked by rubric, and an ungraded or malformed question must not
    // invent an answer for the student to memorise.
    expect(correctMarkdown(q({ type: "essay" }))).toBeNull();
    expect(correctMarkdown(q({ type: "multiple_choice", options: OPTIONS }))).toBeNull();
    expect(correctMarkdown(q({ type: "true_false" }))).toBeNull();
    expect(correctMarkdown(q({ type: "matching", pairs: [] }))).toBeNull();
    expect(correctMarkdown(q({ type: "short_answer", acceptableAnswers: ["", "  "] }))).toBeNull();
  });

  it("ignores an out-of-range correct index instead of computing a stray glyph", () => {
    expect(correctMarkdown(q({ options: OPTIONS, correctOptionIndex: 99 }))).toBeNull();
  });
});
