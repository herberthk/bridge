import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS,
  SUBSIDIARY_LABELS,
  SUB_LEVEL_LABELS,
  type Difficulty,
  type QuestionType,
  type Subject,
} from "@/lib/constants";
import type { ExamParamsInput } from "@/lib/schemas/exam";

/** System instructions for exam generation. */
export function examGenerationInstructions(params: ExamParamsInput): string {
  const typeGuides: Record<QuestionType, string> = {
    multiple_choice:
      "Multiple choice: 4 options (A–D), exactly one correct; set correctOptionIndex (0-based). Options must be plausible but unambiguous.",
    true_false:
      "True/false: a statement whose truth is clearly testable; set correctBool.",
    fill_in_the_blank:
      "Fill in the blank: use ___ in the prompt where the blank sits; list acceptableAnswers (all case/spacing variants that should score).",
    short_answer:
      "Short answer: a concise question answerable in 1–3 words or a phrase; list acceptableAnswers covering fair variants.",
    essay:
      "Essay: an open prompt with clear marking criteria implied; 5–10 points; acceptableAnswers null.",
    matching:
      "Matching: exactly 4 pairs mapping left items to right items; shuffle is handled by the app.",
  };

  const learnerLine =
    params.level === "primary"
      ? `Learner level: Primary class ${params.classLevel} (Uganda).`
      : `Learner level: ${SUB_LEVEL_LABELS[params.secondarySubLevel ?? "o_level"]}, Senior ${params.classLevel} (Uganda).`;
  const depthLine =
    params.level === "secondary" && params.secondarySubLevel === "a_level"
      ? "Calibrate to UACE (A level) depth: analytical, essay-oriented, multi-step problems where appropriate."
      : params.level === "secondary"
        ? "Calibrate to UCE (O level) depth: clear, curriculum-anchored questions."
        : "Calibrate language and depth to young primary learners.";
  const subsidiaryLine = params.subsidiary
    ? `Subject branch: ${SUBSIDIARY_LABELS[params.subsidiary] ?? params.subsidiary} — restrict questions strictly to this branch.`
    : null;

  return [
    "You are an expert Ugandan-curriculum examiner creating assessment content for Bridge.",
    `Subject: ${SUBJECT_LABELS[params.subject as Subject] ?? params.subject}.`,
    learnerLine,
    depthLine,
    subsidiaryLine,
    `Topic/theme: ${params.topic}.`,
    `Difficulty: ${DIFFICULTY_LABELS[params.difficulty as Difficulty] ?? params.difficulty} — calibrate language, depth, and distractors to this band.`,
    `Produce exactly ${params.questionCount} questions distributed across these types: ${params.questionTypes.map((t) => QUESTION_TYPE_LABELS[t]).join(", ")}.`,
    ...(params.includeHints
      ? ["Include a short, nudging hint (not the answer) for each question in `hint`."]
      : ["Set every `hint` to null."]),
    ...(params.includeExplanations
      ? ["Include a 1–3 sentence explanation of the correct answer in `explanation`."]
      : ["Set every `explanation` to null."]),
    ...(params.includeWorkedExamples
      ? [
          "For numerical/technical questions, add a concise worked example in `workedExample` using Markdown with LaTeX math ($...$ inline, $$...$$ display).",
        ]
      : ["Set every `workedExample` to null."]),
    "",
    "Type-specific rules:",
    ...params.questionTypes.map((t) => `- ${typeGuides[t]}`),
    "",
    "Content rules:",
    "- Questions must be factually correct, unambiguous, and self-contained.",
    "- Use Markdown for structure and LaTeX for ALL mathematics (e.g. $x^2 + 2x$).",
    "- Never leak the answer inside the prompt text.",
    "- Spread points sensibly (default 1; essays 5–10; matching 2).",
    "- For the exam title, use a concise descriptive name including the topic.",
  ].join("\n");
}

/** User prompt: parameters summary + optional grounding documents. */
export function examGenerationPrompt(
  params: ExamParamsInput,
  documentExcerpts: { name: string; text: string }[],
): string {
  const lines = [
    `Create a ${params.durationMinutes}-minute assessment.`,
    `Subject: ${SUBJECT_LABELS[params.subject as Subject] ?? params.subject}.`,
    `Class: ${params.level === "primary" ? "Primary" : "Secondary"} ${params.classLevel}.`,
    `Topic: ${params.topic}.`,
    `Questions: ${params.questionCount} (${params.questionTypes.map((t) => QUESTION_TYPE_LABELS[t]).join(", ")}).`,
  ];
  if (params.instructions) {
    lines.push(`Special instructions from the teacher: ${params.instructions}`);
  }

  for (const doc of documentExcerpts) {
    lines.push(
      "",
      `--- Source material: ${doc.name} ---`,
      doc.text,
      `--- End of ${doc.name} ---`,
      "Base the questions, terminology, and difficulty on this material where it is relevant.",
    );
  }
  return lines.join("\n");
}

/** Chunk extracted document text to keep prompts within budget. */
export function chunkDocumentText(
  text: string,
  maxChars = 24_000,
): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  // Keep the head and tail: syllabus content and exercise sections matter.
  const half = Math.floor(maxChars / 2);
  return `${normalized.slice(0, half)}\n\n[…middle section omitted for length…]\n\n${normalized.slice(-half)}`;
}
