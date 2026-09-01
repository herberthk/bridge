import { describe, expect, it } from "vitest";

import {
  changedFields,
  emptyReview,
  hasChanges,
  isAssignGated,
  readReview,
  reviewProgress,
  EDITABLE_FIELDS,
  FIELD_LABELS,
} from "@/lib/exam/review";
import {
  refineQuestionPatch,
  reviseQuestionsSchema,
  saveQuestionsSchema,
  setApprovalSchema,
  validatedQuestionPatchSchema,
  type QuestionPatchInput,
} from "@/lib/schemas/exam-review";
import type { ExamReview } from "@/types/firestore";

/**
 * The review screen's arithmetic runs twice — once in the browser to decide what to
 * render, once on the server to decide what to allow — so a disagreement between
 * the two shows up as a button that offers something the service then refuses. These
 * cover the cases where the two are most likely to drift: documents with no review
 * field, approvals for questions that no longer exist, and a proposal whose fields
 * are all populated but only one of them different.
 */

const ids = (...values: string[]) => values.map((id) => ({ id }));

const review = (overrides: Partial<ExamReview> = {}): ExamReview => ({
  ...emptyReview(),
  ...overrides,
});

describe("readReview", () => {
  it("reads a missing review as nothing approved", () => {
    // Every exam generated before this screen existed has no `review` key at all,
    // and `approvedIds` has to be safe to call `.includes` on regardless.
    expect(readReview(undefined)).toEqual(emptyReview());
    expect(readReview(null)).toEqual(emptyReview());
  });

  it("survives a partially-written review", () => {
    const partial = { approvedIds: ["a", "b"] } as ExamReview;
    const result = readReview(partial);
    expect(result.approvedIds).toEqual(["a", "b"]);
    expect(result.revisedCount).toBe(0);
    expect(result.approvedAt).toBeNull();
  });

  it("drops falsy ids rather than counting them", () => {
    const dirty = { approvedIds: ["a", "", "b"] } as ExamReview;
    expect(readReview(dirty).approvedIds).toEqual(["a", "b"]);
  });

  it("replaces a non-numeric revisedCount with zero", () => {
    const dirty = { approvedIds: [], revisedCount: NaN } as unknown as ExamReview;
    expect(readReview(dirty).revisedCount).toBe(0);
  });
});

describe("reviewProgress", () => {
  it("counts approvals against the questions that exist", () => {
    const progress = reviewProgress(ids("q1", "q2", "q3", "q4"), review({ approvedIds: ["q1", "q3"] }));
    expect(progress.approved).toBe(2);
    expect(progress.total).toBe(4);
    expect(progress.pendingIds).toEqual(["q2", "q4"]);
    expect(progress.percent).toBe(50);
    expect(progress.complete).toBe(false);
  });

  it("ignores an approval for a question no longer in the exam", () => {
    // Counting `approvedIds.length` instead would report 3 of 2 reviewed and let a
    // paper with an unread question walk through the assign gate.
    const progress = reviewProgress(ids("q1", "q2"), review({ approvedIds: ["q1", "gone", "also-gone"] }));
    expect(progress.approved).toBe(1);
    expect(progress.total).toBe(2);
    expect(progress.pendingIds).toEqual(["q2"]);
    expect(progress.complete).toBe(false);
  });

  it("returns pending ids in paper order", () => {
    // The "Approve remaining" button and the "next unreviewed question" jump both
    // read this order; reviewing a 60-question paper out of order is disorienting.
    const progress = reviewProgress(ids("a", "b", "c", "d", "e"), review({ approvedIds: ["c"] }));
    expect(progress.pendingIds).toEqual(["a", "b", "d", "e"]);
  });

  it("is complete only when every question is signed off", () => {
    expect(reviewProgress(ids("q1", "q2"), review({ approvedIds: ["q1", "q2"] })).complete).toBe(true);
    expect(reviewProgress(ids("q1", "q2"), review({ approvedIds: ["q1", "q2"] })).percent).toBe(100);
  });

  it("does not call an exam with no questions reviewed", () => {
    // 0 of 0 is arithmetically complete and would open the gate on an empty paper.
    const progress = reviewProgress([], review());
    expect(progress.complete).toBe(false);
    expect(progress.percent).toBe(0);
  });

  it("rounds the percentage for the progress bar", () => {
    expect(reviewProgress(ids("a", "b", "c"), review({ approvedIds: ["a"] })).percent).toBe(33);
    expect(reviewProgress(ids("a", "b", "c"), review({ approvedIds: ["a", "b"] })).percent).toBe(67);
  });
});

describe("isAssignGated", () => {
  it("gates a draft with unreviewed questions", () => {
    expect(isAssignGated({ status: "draft", questions: ids("q1", "q2"), review: review() })).toBe(true);
  });

  it("opens once the draft is fully reviewed", () => {
    expect(
      isAssignGated({
        status: "draft",
        questions: ids("q1", "q2"),
        review: review({ approvedIds: ["q1", "q2"] }),
      }),
    ).toBe(false);
  });

  it("never gates an exam that has already been assigned", () => {
    // Every exam in every existing library is in exactly this position, and gating
    // them now would retroactively fault work done before the screen existed.
    for (const status of ["scheduled", "active", "archived"]) {
      expect(isAssignGated({ status, questions: ids("q1"), review: review() })).toBe(false);
    }
  });

  it("gates a draft with a missing review field", () => {
    expect(isAssignGated({ status: "draft", questions: ids("q1") })).toBe(true);
  });
});

describe("changedFields", () => {
  it("reports only the field that moved", () => {
    // A revision returns the whole question, most of it byte-identical. Showing all
    // of it makes the reviewer hunt for the one line that changed.
    const before = { prompt: "What is 2 + 2?", points: 1, hint: "Count.", options: ["3", "4"] };
    const after = { prompt: "What is 3 + 4?", points: 1, hint: "Count.", options: ["3", "4"] };
    expect(changedFields(before, after)).toEqual(["prompt"]);
    expect(hasChanges(before, after)).toBe(true);
  });

  it("treats an omitted field as unchanged, not cleared", () => {
    // A terse model that returns no `explanation` must not wipe the one on record.
    const before = { prompt: "Q", explanation: "Because." };
    expect(changedFields(before, { prompt: "Q" })).toEqual([]);
  });

  it("keeps null, empty string and empty array distinct", () => {
    // These are three different states of an option list, and collapsing them hid
    // the revision that cleared a field.
    expect(changedFields({ options: null }, { options: [] })).toEqual(["options"]);
    expect(changedFields({ hint: null }, { hint: "" })).toEqual(["hint"]);
    expect(changedFields({ options: ["a"] }, { options: [] })).toEqual(["options"]);
  });

  it("conflates null and undefined, which are the same absence", () => {
    expect(changedFields({ hint: null }, { hint: undefined })).toEqual([]);
  });

  it("ignores whitespace-only changes to a string field", () => {
    expect(changedFields({ prompt: "  What is 2+2? " }, { prompt: "What is 2+2?" })).toEqual([]);
  });

  it("detects a changed answer key on every type", () => {
    expect(changedFields({ correctOptionIndex: 1 }, { correctOptionIndex: 2 })).toEqual([
      "correctOptionIndex",
    ]);
    expect(changedFields({ correctBool: true }, { correctBool: false })).toEqual(["correctBool"]);
    expect(
      changedFields(
        { pairs: [{ left: "a", right: "b" }] },
        { pairs: [{ left: "a", right: "c" }] },
      ),
    ).toEqual(["pairs"]);
  });

  it("does not mistake index 0 for an absent answer key", () => {
    // `correctOptionIndex: 0` is a valid, common answer key and is falsy.
    expect(changedFields({ correctOptionIndex: 0 }, { correctOptionIndex: 0 })).toEqual([]);
    expect(changedFields({ correctOptionIndex: null }, { correctOptionIndex: 0 })).toEqual([
      "correctOptionIndex",
    ]);
  });

  it("returns fields in a stable display order", () => {
    const changes = changedFields(
      { points: 1, prompt: "a", hint: "x" },
      { points: 2, prompt: "b", hint: "y" },
    );
    expect(changes).toEqual(["prompt", "points", "hint"]);
  });

  it("labels every editable field", () => {
    // The diff view renders `FIELD_LABELS[field]`; a missing entry prints
    // "undefined" above a pane of changed content.
    for (const field of EDITABLE_FIELDS) {
      expect(FIELD_LABELS[field]).toBeTruthy();
    }
  });
});

/* ── The inbound contracts, which are what stands between a public POST and the
      stored exam ───────────────────────────────────────────────────────────── */

const patch = (overrides: Partial<QuestionPatchInput> = {}): QuestionPatchInput =>
  ({
    id: "q1",
    type: "multiple_choice",
    prompt: "What is $2 + 2$?",
    options: ["3", "4", "5", "6"],
    correctOptionIndex: 1,
    points: 1,
    ...overrides,
  }) as QuestionPatchInput;

const issuePaths = (input: QuestionPatchInput): string[] => {
  const parsed = validatedQuestionPatchSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0]));
};

describe("validatedQuestionPatchSchema", () => {
  it("accepts a complete multiple-choice question", () => {
    expect(validatedQuestionPatchSchema.safeParse(patch()).success).toBe(true);
  });

  it("requires two filled options and a key that points at one", () => {
    expect(issuePaths(patch({ options: ["4", "", "", ""] }))).toContain("options");
    // Pointing the key at a blank trailing row is how a question ends up with no
    // correct answer at all, so the check counts filled options, not array length.
    expect(issuePaths(patch({ options: ["3", "4", "", ""], correctOptionIndex: 2 }))).toContain(
      "correctOptionIndex",
    );
    expect(issuePaths(patch({ correctOptionIndex: null }))).toContain("correctOptionIndex");
  });

  it("requires a boolean on a true/false question", () => {
    const tf = { id: "q1", type: "true_false", prompt: "Water boils at 100°C.", points: 1 };
    expect(issuePaths(tf as QuestionPatchInput)).toContain("correctBool");
    expect(
      validatedQuestionPatchSchema.safeParse({ ...tf, correctBool: false }).success,
    ).toBe(true);
  });

  it("requires at least one accepted answer on a short answer", () => {
    const sa = { id: "q1", type: "short_answer", prompt: "Name the capital.", points: 2 };
    expect(issuePaths(sa as QuestionPatchInput)).toContain("acceptableAnswers");
    expect(
      validatedQuestionPatchSchema.safeParse({ ...sa, acceptableAnswers: ["Kampala"] }).success,
    ).toBe(true);
  });

  it("rejects LaTeX in accepted answers", () => {
    // These are string-matched against what a student types: `$\frac{9}{5}$` can
    // never equal `1.8`, and the student who answered correctly loses the mark.
    const sa = {
      id: "q1",
      type: "short_answer",
      prompt: "Convert to a decimal.",
      points: 1,
      acceptableAnswers: [String.raw`$\frac{9}{5}$`],
    };
    expect(issuePaths(sa as QuestionPatchInput)).toContain("acceptableAnswers");
    expect(
      validatedQuestionPatchSchema.safeParse({ ...sa, acceptableAnswers: ["1.8", "9/5"] }).success,
    ).toBe(true);
  });

  it("requires the blank marker on a fill-in-the-blank prompt", () => {
    const base = {
      id: "q1",
      type: "fill_in_the_blank",
      points: 1,
      acceptableAnswers: ["photosynthesis"],
    };
    expect(issuePaths({ ...base, prompt: "Plants make food by." } as QuestionPatchInput)).toContain(
      "prompt",
    );
    expect(
      validatedQuestionPatchSchema.safeParse({ ...base, prompt: "Plants make food by ___." })
        .success,
    ).toBe(true);
  });

  it("requires two complete pairs on a matching question", () => {
    const base = { id: "q1", type: "matching", prompt: "Match them.", points: 4 };
    expect(
      issuePaths({ ...base, pairs: [{ left: "a", right: "b" }] } as QuestionPatchInput),
    ).toContain("pairs");
    // A half-filled row does not count towards the two.
    expect(
      issuePaths({
        ...base,
        pairs: [
          { left: "a", right: "b" },
          { left: "c", right: "" },
        ],
      } as QuestionPatchInput),
    ).toContain("pairs");
  });

  it("requires matching pairs to be one-to-one", () => {
    const base = { id: "q1", type: "matching", prompt: "Match them.", points: 4 };
    expect(
      issuePaths({
        ...base,
        pairs: [
          { left: "a", right: "b" },
          { left: "a", right: "d" },
        ],
      } as QuestionPatchInput),
    ).toContain("pairs");
    expect(
      issuePaths({
        ...base,
        pairs: [
          { left: "a", right: "b" },
          { left: "c", right: "b" },
        ],
      } as QuestionPatchInput),
    ).toContain("pairs");
    expect(
      issuePaths({
        ...base,
        pairs: [
          { left: "a", right: "b" },
          { left: "c", right: "d" },
          { left: " a ", right: "" },
        ],
      } as QuestionPatchInput),
    ).toContain("pairs");
    expect(
      validatedQuestionPatchSchema.safeParse({
        ...base,
        pairs: [
          { left: "a", right: "b" },
          { left: "c", right: "d" },
        ],
      }).success,
    ).toBe(true);
  });

  it("bounds marks to something a paper can carry", () => {
    expect(validatedQuestionPatchSchema.safeParse(patch({ points: 0 })).success).toBe(false);
    expect(validatedQuestionPatchSchema.safeParse(patch({ points: 51 })).success).toBe(false);
    expect(validatedQuestionPatchSchema.safeParse(patch({ points: 1.5 })).success).toBe(false);
  });

  it("rejects an empty prompt", () => {
    expect(issuePaths(patch({ prompt: "   " }))).toContain("prompt");
  });

  it("leaves a visual it cannot validate to the server's sanitizer", () => {
    // Validating the shape here could only turn a repairable visual into a rejected
    // save, and this payload's other source is the model itself.
    expect(
      validatedQuestionPatchSchema.safeParse(patch({ visual: { kind: "nonsense" } })).success,
    ).toBe(true);
  });

  it("runs the same refinement the editor runs, on the same paths", () => {
    // The inline editor calls `refineQuestionPatch` directly so a reviewer sees
    // "Mark which option is correct" before the round trip rather than after it.
    const paths: string[] = [];
    refineQuestionPatch(patch({ correctOptionIndex: null }), {
      addIssue: (issue: { path?: PropertyKey[] }) => paths.push(String(issue.path?.[0])),
    } as never);
    expect(paths).toContain("correctOptionIndex");
  });
});

describe("saveQuestionsSchema", () => {
  it("accepts a single-question save and approves by default", () => {
    const parsed = saveQuestionsSchema.safeParse({ examId: "e1", questions: [patch()] });
    expect(parsed.success).toBe(true);
    // "Save" means "I have read this and it is right", so approval is the default.
    expect(parsed.success && parsed.data.approve).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(saveQuestionsSchema.safeParse({ examId: "e1", questions: [] }).success).toBe(false);
  });

  it("rejects duplicate question ids in one batch", () => {
    // Two patches for one id is an ordering question with no right answer — the
    // second silently winning is worse than refusing.
    expect(
      saveQuestionsSchema.safeParse({
        examId: "e1",
        questions: [patch(), patch({ prompt: "Different, same id" })],
      }).success,
    ).toBe(false);
  });

  it("rejects a batch past the cap", () => {
    const many = Array.from({ length: 26 }, (_, i) => patch({ id: `q${i}` }));
    expect(saveQuestionsSchema.safeParse({ examId: "e1", questions: many }).success).toBe(false);
  });
});

describe("reviseQuestionsSchema", () => {
  const item = { questionId: "q1", instruction: "Use metres instead of feet." };

  it("accepts a batch of instructions", () => {
    expect(reviseQuestionsSchema.safeParse({ examId: "e1", items: [item] }).success).toBe(true);
  });

  it("rejects an instruction too short to act on", () => {
    expect(
      reviseQuestionsSchema.safeParse({ examId: "e1", items: [{ ...item, instruction: "no" }] })
        .success,
    ).toBe(false);
  });

  it("rejects two instructions for the same question", () => {
    // One note per question, because the prompt sends one instruction per id and a
    // second would silently be dropped.
    expect(
      reviseQuestionsSchema.safeParse({ examId: "e1", items: [item, { ...item, instruction: "Also shorten it." }] })
        .success,
    ).toBe(false);
  });

  it("caps the batch so one call cannot run past the model timeout", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...item, questionId: `q${i}` }));
    expect(reviseQuestionsSchema.safeParse({ examId: "e1", items: many }).success).toBe(false);
  });

  it("trims the instruction", () => {
    const parsed = reviseQuestionsSchema.safeParse({
      examId: "e1",
      items: [{ ...item, instruction: "  Shorten it.  " }],
    });
    expect(parsed.success && parsed.data.items[0]!.instruction).toBe("Shorten it.");
  });
});

describe("setApprovalSchema", () => {
  it("accepts a bulk approval", () => {
    expect(
      setApprovalSchema.safeParse({ examId: "e1", questionIds: ["q1", "q2"], approved: true })
        .success,
    ).toBe(true);
  });

  it("accepts a withdrawal", () => {
    expect(
      setApprovalSchema.safeParse({ examId: "e1", questionIds: ["q1"], approved: false }).success,
    ).toBe(true);
  });

  it("rejects an empty id list", () => {
    expect(
      setApprovalSchema.safeParse({ examId: "e1", questionIds: [], approved: true }).success,
    ).toBe(false);
  });
});
