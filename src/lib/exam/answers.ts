import type { Question } from "@/types/firestore";

/**
 * Answer presentation for the results review.
 *
 * Pure and DOM-free on purpose — the same rules are wanted by the student review,
 * the PDF report and a node-environment test suite, and the letter arithmetic
 * (`65 + index`) is exactly the kind of thing that silently goes off by one.
 *
 * Both functions return Markdown, not plain text: multiple-choice options and
 * matching pairs carry LaTeX (`$\frac{9}{5}$`), so their output is meant for the
 * `Markdown` component rather than a text node.
 */

/** Everything these helpers need from a question — the answer key included. */
export type AnswerKeyQuestion = Pick<
  Question,
  "type" | "options" | "correctOptionIndex" | "correctBool" | "acceptableAnswers" | "pairs"
>;

/** `0 → "A"`, `25 → "Z"`, and anything outside that range gets no letter. */
function optionLetter(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 25) return null;
  return String.fromCharCode(65 + index);
}

/**
 * A stored response as one Markdown string, or null when nothing was attempted.
 *
 * A multiple-choice response is stored as the option *index*. Rendering it as a
 * bare letter left the review reporting "B" beside a correct answer written out in
 * full, so the student had to scroll back to the prompt to see what they had
 * picked; resolving the index carries the option's notation across too.
 */
export function answerMarkdown(
  value: unknown,
  question: Pick<Question, "type" | "options">,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (question.type === "multiple_choice" && typeof value === "number") {
    const letter = optionLetter(value);
    if (letter === null) return null;
    const option = question.options?.[value]?.trim();
    return option ? `${letter}. ${option}` : letter;
  }
  if (Array.isArray(value)) {
    // Fill-in-the-blank and matching answers are per-slot arrays, and an array of
    // empty strings is what an untouched question looks like — not an answer of "".
    const parts = value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const text = String(value).trim();
  return text || null;
}

/**
 * The answer key as one Markdown string, per question type.
 *
 * `acceptableAnswers` are plain by contract — they are string-matched against what
 * the student typed, so the generator is told to keep `$` and `\frac` out of them.
 * Options and pairs are the opposite, which is why the whole result goes through
 * the Markdown renderer rather than being split by type at the call site.
 */
export function correctMarkdown(question: AnswerKeyQuestion): string | null {
  if (question.type === "multiple_choice" && typeof question.correctOptionIndex === "number") {
    const letter = optionLetter(question.correctOptionIndex);
    if (letter === null) return null;
    const option = question.options?.[question.correctOptionIndex]?.trim();
    return option ? `${letter}. ${option}` : letter;
  }
  if (question.type === "true_false" && typeof question.correctBool === "boolean") {
    return question.correctBool ? "True" : "False";
  }
  if (question.type === "matching" && question.pairs?.length) {
    const rows = question.pairs
      .map((pair) => {
        const left = pair?.left?.trim();
        const right = pair?.right?.trim();
        return left && right ? `${left} → ${right}` : null;
      })
      .filter((row): row is string => row !== null);
    return rows.length > 0 ? rows.join("; ") : null;
  }
  const accepted = question.acceptableAnswers
    ?.map((answer) => String(answer ?? "").trim())
    .filter(Boolean);
  return accepted?.length ? accepted.join(" / ") : null;
}
