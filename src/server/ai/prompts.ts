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
    `Produce EXACTLY ${params.questionCount} questions — not fewer, not more. Count them before you finish: the "questions" array length must equal ${params.questionCount}. If you cannot fit them in one response, still return all ${params.questionCount}.`,
    ...(params.includeHints
      ? ["Include a short, nudging hint (not the answer) for each question in `hint`."]
      : ["Set every `hint` to null."]),
    ...(params.includeExplanations
      ? ["Include a 1–3 sentence explanation of the correct answer in `explanation`."]
      : ["Set every `explanation` to null."]),
    ...(params.includeWorkedExamples
      ? [
          // Bounded on purpose. "Concise" alone was the single largest source of
          // output-length variance: a `very_hard` maths derivation has no natural
          // stopping point, so five identically-shaped questions came back at
          // 2,592 tokens in one call and over 7,243 in another, and the long one
          // was cut off at `maxOutputTokens` and lost entirely. A step budget makes
          // the cost of a question something the planner can predict.
          "For numerical/technical questions, add a worked example in `workedExample` using Markdown with LaTeX math ($...$ inline, $$...$$ display).",
          "Keep each worked example to at most 6 short steps and roughly 80 words. Show the method, not every algebraic rearrangement; state a result rather than deriving a standard identity.",
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
    // Deliberately *not* "use your full output budget". That line was here, and it
    // told the model to spend up to the cap — which on Gemini 3 is a hard mid-stream
    // stop, so the advice produced the truncation it was warning about. The count is
    // already stated above; what helps here is the opposite instruction.
    `- CRITICAL: the array must hold exactly ${params.questionCount} question(s). Prefer shorter prose in every field over dropping a question: a set of ${params.questionCount} brief questions is correct, and a set of ${params.questionCount - 1} thorough ones is a failure.`,
    "",
    "Visual aids (hybrid — responsive charts/tables where they help):",
    "- Where a question benefits from data, comparison, distribution, trend, or tabular reference, include a `visual` field.",
    "- `visual` is either null or {kind:\"chart\"|\"table\"}.",
    '  • kind:\"chart\" => {chartType:\"bar\"|\"line\"|\"pie\"|\"area\", title?, caption?, data:[{...}], xKey?, yKey?}',
    "    - data must be 2–12 uniform objects, e.g. [{\"label\":\"2019\",\"value\":40}, {\"label\":\"2020\",\"value\":55}] or [{\"month\":\"Jan\",\"sales\":120}].",
    "    - xKey is the label/category key (e.g. \"label\" or \"month\"), yKey is the numeric key (e.g. \"value\" or \"sales\"). If omitted we infer them.",
    "    - Prefer bar for categories/comparisons, line/area for trends over time, pie for single composition (≤6 slices).",
    '  • kind:\"table\" => {title?, caption?, headers:[\"Col A\",\"Col B\"], rows:[[\"r1c1\",\"r1c2\"], ...]} — 2–8 columns, 1–12 rows, short cell text.',
    "    - Every row must contain exactly as many cells as there are headers, and every cell must be a non-empty string (write \"0\" or \"n/a\" rather than leaving a gap).",
    "- Use visuals sparingly but meaningfully: roughly 20–40% of questions where a visual clarifies context (e.g. Maths statistics, Science experiments, Geography data, Economics/Commerce figures). Do not force a visual on every question.",
    "- Simple markdown tables in the prompt are still allowed for quick tabular data, but prefer the structured `visual` for any graphic-worthy dataset so the app can render a responsive, accessible chart/table.",
    "- Keep chart data realistic and curriculum-relevant; include a caption when the visual needs interpretation (e.g. \"Source: sample experiment\").",
    "- Visual data must support the question without giving away the answer directly.",
    "",
    // This block is load-bearing, not documentation. The provider used to be sent a
    // `responseSchema`, so the field list reached the model as a decoding grammar and
    // none of it had to be said out loud. Constrained decoding is now off (see
    // `structuredOutputs` in `exams.ts` for the measurements that forced that), which
    // means this text is the only description of the envelope the model ever sees.
    // Anything dropped from here comes back as a zod failure that costs a whole chunk.
    "Output format:",
    "- Return ONLY a JSON object — no code fence, no commentary before or after it.",
    `- Shape: {"title": string, "questions": [ ... ]}, with exactly ${params.questionCount} entries in "questions".`,
    "- Every question object must contain ALL of these keys, using null where a key does not apply:",
    "  type, prompt, options, correctOptionIndex, correctBool, acceptableAnswers, pairs, points, hint, explanation, workedExample, visual",
    `- "type" is one of: ${params.questionTypes.map((t) => `"${t}"`).join(", ")}.`,
    '- "prompt" is a non-empty string. "options" is an array of strings for multiple choice, else null. "correctOptionIndex" is a 0-based integer or null. "correctBool" is a boolean or null. "acceptableAnswers" is an array of strings or null. "pairs" is an array of {"left": string, "right": string} or null. "points" is an integer.',
    '- "hint", "explanation" and "workedExample" are strings or null, per the rules above. "visual" is null or one of the chart/table objects described above.',
    // The repetition collapse this guards against is a decoding pathology, not a
    // misunderstanding, so the instruction is not expected to carry the fix on its own
    // — it is the cheap half of a two-part guard whose other half is `clampProse`.
    "- Never repeat a phrase or sentence. State each step once, then move on and close the string. Repeated text is a failure, not thoroughness.",
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
