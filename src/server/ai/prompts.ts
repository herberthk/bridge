import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS,
  SUBSIDIARY_LABELS,
  SUB_LEVEL_LABELS,
  type Difficulty,
  type QuestionType,
  type SchoolLevel,
  type Subject,
} from "@/lib/constants";
import type { ExamParamsInput } from "@/lib/schemas/exam";

/**
 * Notation rules, shared by generation and by revision.
 *
 * Extracted rather than duplicated because these are not style advice — every line
 * is a malformation observed in a live paper, and a revision call that omitted them
 * would reintroduce, in the rewrite, exactly the breakage the reviewer asked to
 * have fixed. One copy also means a rule learned from a new failure is learned by
 * both callers at once.
 *
 * The expensive one is the piecewise case: the model writes
 * `$f(x) = {kx(2-x), 0 \le x \le 2, 0, \text{otherwise}$`, KaTeX reads the bare `{`
 * as a group that never closes, fails the whole span, and the conditions land under
 * the formula as unstyled text — which is what a student sits with. `repairMath` in
 * `src/lib/exam/latex.ts` recovers these on the way in *and* on render; this block
 * is the cheap half that stops them being produced.
 */
function mathsFormattingRules(level: SchoolLevel): string[] {
  return [
    "Maths and notation formatting:",
    "- Delimiters: `$...$` for maths inside a sentence, `$$...$$` on its own line for a standalone formula. Never use \\( \\) or \\[ \\], and never leave a `$` unpaired.",
    "- Every group must close: balanced `{}`, a `\\right` for every `\\left`, an `\\end{X}` for every `\\begin{X}`. An unclosed bracket or brace destroys the whole formula.",
    "- Piecewise and cumulative distribution functions MUST be formatted as a standalone display formula `$$...$$` with a `cases` environment:",
    "  correct: $$f(x) = \\begin{cases} kx(2-x) & 0 \\le x \\le 2 \\\\ 0 & \\text{otherwise} \\end{cases}$$",
    "  wrong:   $f(x) = {kx(2-x), 0 \\le x \\le 2, 0, \\text{otherwise}$",
    "  wrong:   $f(x) = \\begin{cases} kx(2-x) \\\\ 0 \\end{cases}$ $0 \\le x \\le 2$ (NEVER put conditions outside the cases block)",
    "  Every branch MUST have `&` preceding the condition on that line, and use `\\text{otherwise}` for words inside maths.",
    "- Write fractions as `\\frac{a}{b}`, roots as `\\sqrt{x}`, and keep every exponent/subscript braced when longer than one character (`x^{n+1}`, `\\sum x_{i}^{2}`).",
    "- Units and words belong in `\\text{}` inside maths (`5\\,\\text{cm}`) or outside the delimiters entirely — never bare (`5 cm` is fine in prose).",
    "- Escape `%` as `\\%` inside maths; a bare `%` comments out the rest of the expression.",
    ...(level === "primary"
      ? [
          "- This is a primary class: keep notation to arithmetic the learner has met ($12 \\times 4$, $\\frac{3}{4}$). No summation, integral or set-builder notation.",
        ]
      : []),
    "",
    "Where maths must appear correctly:",
    "- `prompt`: as above. If a formula defines the question, put it on its own line as `$$...$$` rather than inline.",
    "- `options`: each option is a complete, self-contained expression — `\"$\\\\frac{9}{5}$\"`, not `\"9/5\"` and not a fragment that only parses next to its neighbours. All four options must use the same form.",
    "- `pairs`: both `left` and `right` are short and independently valid; wrap any notation.",
    "- `acceptableAnswers`: plain, unformatted answers only (`\"1.2\"`, `\"9/5\"`, `\"kx(2-x)\"`) — these are string-matched against what the student types, so no `$`, no `\\frac`, no Markdown.",
    "- `fill_in_the_blank`: the `___` marker stays outside the maths delimiters.",
    "- `hint`, `explanation`, `workedExample`: same delimiter and balance rules as `prompt`.",
  ];
}

/**
 * Visual-aid rules, shared by generation and by revision.
 *
 * Static, unlike the maths block: none of it varies by level. Split into the "what
 * a visual is" half and the "when to use one" half because a revision only needs
 * the first — it is fixing a named question, not deciding how much of a paper
 * should carry a chart.
 */
const VISUAL_SHAPE_RULES: string[] = [
  "- `visual` is either null or {kind:\"chart\"|\"table\"}.",
  '  • kind:\"chart\" => {chartType:\"bar\"|\"line\"|\"pie\"|\"area\", title?, caption?, data:[{...}], xKey?, yKey?}',
  "    - data must be 2–12 uniform objects, e.g. [{\"label\":\"2019\",\"value\":40}, {\"label\":\"2020\",\"value\":55}] or [{\"month\":\"Jan\",\"sales\":120}].",
  "    - xKey is the label/category key (e.g. \"label\" or \"month\"), yKey is the numeric key (e.g. \"value\" or \"sales\"). If omitted we infer them.",
  "    - Prefer bar for categories/comparisons, line/area for trends over time, pie for single composition (≤6 slices).",
  // Axis ticks and legends are SVG text nodes; KaTeX cannot typeset inside them,
  // so LaTeX in chart data reaches the page as backslashes.
  "    - Chart values must be plain JSON numbers (40, not \"40\") and chart labels plain short text — NO LaTeX or `$` anywhere in `data`.",
  '  • kind:\"table\" => {title?, caption?, headers:[\"Col A\",\"Col B\"], rows:[[\"r1c1\",\"r1c2\"], ...]} — 2–8 columns, 1–12 rows, short cell text.',
  "    - Every row must contain exactly as many cells as there are headers, and every cell must be a non-empty string (write \"0\" or \"n/a\" rather than leaving a gap).",
  // The bivariate-statistics table that shipped `\sum x`, `\sum y`, `\sum x^2` as
  // literal characters is exactly this: notation written without delimiters into a
  // column that is *about* notation.
  "    - Table cells DO render maths, so any notation in a header or cell must be wrapped: \"$\\\\sum x^{2}$\", not \"\\\\sum x^2\". Keep each cell under ~40 characters.",
  "- Keep chart data realistic and curriculum-relevant; include a caption when the visual needs interpretation (e.g. \"Source: sample experiment\").",
  "- Visual data must support the question without giving away the answer directly.",
];

/** Per-type authoring rules, shared by generation and revision. */
const TYPE_GUIDES: Record<QuestionType, string> = {
  multiple_choice:
    "Multiple choice: 4 options (A–D), exactly one correct; set correctOptionIndex (0-based). Options must be plausible but unambiguous.",
  true_false: "True/false: a statement whose truth is clearly testable; set correctBool.",
  fill_in_the_blank:
    "Fill in the blank: use ___ in the prompt where the blank sits; list acceptableAnswers (all case/spacing variants that should score).",
  short_answer:
    "Short answer: a concise question answerable in 1–3 words or a phrase; list acceptableAnswers covering fair variants.",
  essay: "Essay: an open prompt with clear marking criteria implied; 5–10 points; acceptableAnswers null.",
  matching:
    "Matching: exactly 4 pairs mapping left items to right items; shuffle is handled by the app.",
};

/** The learner/level framing every call shares. */
function learnerContextLines(params: ExamParamsInput): (string | null)[] {
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
    `Subject: ${SUBJECT_LABELS[params.subject as Subject] ?? params.subject}.`,
    learnerLine,
    depthLine,
    subsidiaryLine,
    `Topic/theme: ${params.topic}.`,
    `Difficulty: ${DIFFICULTY_LABELS[params.difficulty as Difficulty] ?? params.difficulty} — calibrate language, depth, and distractors to this band.`,
  ];
}

/** System instructions for exam generation. */
export function examGenerationInstructions(params: ExamParamsInput): string {
  return [
    "You are an expert Ugandan-curriculum examiner creating assessment content for Bridge.",
    ...learnerContextLines(params),
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
    ...params.questionTypes.map((t) => `- ${TYPE_GUIDES[t]}`),
    "",
    "Content rules:",
    "- Questions must be factually correct, unambiguous, and self-contained.",
    "- Use Markdown for structure and LaTeX for ALL mathematics (e.g. $x^2 + 2x$), following the maths formatting rules below.",
    "- Never leak the answer inside the prompt text.",
    "- Spread points sensibly (default 1; essays 5–10; matching 2).",
    "- For the exam title, use a concise descriptive name including the topic.",
    // Deliberately *not* "use your full output budget". That line was here, and it
    // told the model to spend up to the cap — which on Gemini 3 is a hard mid-stream
    // stop, so the advice produced the truncation it was warning about. The count is
    // already stated above; what helps here is the opposite instruction.
    `- CRITICAL: the array must hold exactly ${params.questionCount} question(s). Prefer shorter prose in every field over dropping a question: a set of ${params.questionCount} brief questions is correct, and a set of ${params.questionCount - 1} thorough ones is a failure.`,
    "",
    ...mathsFormattingRules(params.level),
    "",
    "Visual aids (hybrid — responsive charts/tables where they help):",
    "- Where a question benefits from data, comparison, distribution, trend, or tabular reference, include a `visual` field.",
    ...VISUAL_SHAPE_RULES,
    "- Use visuals sparingly but meaningfully: roughly 20–40% of questions where a visual clarifies context (e.g. Maths statistics, Science experiments, Geography data, Economics/Commerce figures). Do not force a visual on every question.",
    "- Simple markdown tables in the prompt are still allowed for quick tabular data, but prefer the structured `visual` for any graphic-worthy dataset so the app can render a responsive, accessible chart/table.",
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

/* ── Revision: rewriting named questions on reviewer instruction ───────── */

/** One question the reviewer has asked to have changed. */
export interface RevisionRequestItem {
  /** Stored question id — echoed back by the model so the write can match on it. */
  id: string;
  /** 1-based position in the paper, for the model's sense of context only. */
  number: number;
  type: QuestionType;
  /** The stored question, exactly as it is now. */
  current: Record<string, unknown>;
  /** What the reviewer wants changed, in their own words. */
  instruction: string;
}

/**
 * System instructions for a revision pass.
 *
 * Deliberately not a diff protocol. The model is asked for each question whole,
 * because a patch format would need the model to name the fields it is changing —
 * and a rewrite that fixes a formula usually has to touch the options, the
 * explanation and the worked example to stay consistent. Asking for the whole
 * question and diffing locally (`changedFields` in `@/lib/exam/review`) puts that
 * bookkeeping where it cannot be got wrong.
 *
 * `types` is the set present in the request rather than the exam's whole
 * configuration: sending the matching rules along with a revision of three
 * multiple-choice questions is prompt weight that can only invite the model to
 * change a question's type.
 */
export function questionRevisionInstructions(
  params: ExamParamsInput,
  types: QuestionType[],
): string {
  const uniqueTypes = [...new Set(types)];
  return [
    "You are an expert Ugandan-curriculum examiner revising questions in an existing exam, on the instruction of the teacher reviewing it.",
    ...learnerContextLines(params),
    "",
    "How to revise:",
    "- You are given specific questions with the teacher's instruction for each. Apply that instruction faithfully — it is a decision, not a suggestion.",
    "- Return each question COMPLETE: every field, rewritten where the instruction requires it and carried over unchanged where it does not. A field you omit or null out is a field the teacher loses.",
    "- Change nothing the instruction did not ask for. The teacher is comparing your version against the original side by side; unrequested edits are noise they have to review.",
    // Type is fixed rather than merely discouraged. Attempts already in flight store
    // answers shaped by the question's type, so a type change would leave a recorded
    // response pointing at a shape that no longer exists.
    "- NEVER change a question's `type` or its `id`. Both are fixed. Echo the `id` back exactly as given.",
    "- Keep the answer key correct and consistent with your rewrite. If you reorder or replace options, move `correctOptionIndex` to match — an out-of-date index is worse than the original question.",
    "- If the instruction is impossible or would make the question wrong, return the closest correct question you can and say so in `changeNote`.",
    "- `changeNote` is one short sentence naming what you changed, for the teacher to read above the diff.",
    "",
    "Type-specific rules for the questions in this request:",
    ...uniqueTypes.map((t) => `- ${TYPE_GUIDES[t]}`),
    "",
    ...mathsFormattingRules(params.level),
    "",
    "Visual aids:",
    "- Keep an existing `visual` unless the instruction concerns it; set it to null only if asked to remove it.",
    ...VISUAL_SHAPE_RULES,
    "",
    // Same reasoning as the generation envelope: with constrained decoding off, this
    // block is the only description of the output shape the model ever sees.
    "Output format:",
    "- Return ONLY a JSON object — no code fence, no commentary before or after it.",
    '- Shape: {"questions": [ ... ]} — one entry per question you were given, in the same order, and nothing else.',
    "- Every question object must contain ALL of these keys, using null where a key does not apply:",
    "  id, type, prompt, options, correctOptionIndex, correctBool, acceptableAnswers, pairs, points, hint, explanation, workedExample, visual, changeNote",
    '- "id" is the exact id you were given. "type" is unchanged from the input.',
    '- "prompt" is a non-empty string. "options" is an array of strings for multiple choice, else null. "correctOptionIndex" is a 0-based integer or null. "correctBool" is a boolean or null. "acceptableAnswers" is an array of strings or null. "pairs" is an array of {"left": string, "right": string} or null.',
    '- "points" is the mark value. Repeat the value you were given unless the instruction changes what the question is worth; null also means unchanged.',
    '- "hint", "explanation" and "workedExample" are strings or null — carry the existing value over unless the instruction changes it. "visual" is null or one of the chart/table objects described above.',
    "- Never repeat a phrase or sentence. State each step once, then move on and close the string.",
  ].join("\n");
}

/**
 * User prompt for a revision pass: each question as stored, with its instruction.
 *
 * The current question goes in as JSON rather than as rendered text so that the
 * model sees the same field names it must return, and sees which fields are already
 * null. Describing it in prose instead produced rewrites that quietly dropped
 * `hint` and `workedExample` — the model had no way to know they existed.
 */
export function questionRevisionPrompt(
  params: ExamParamsInput,
  items: RevisionRequestItem[],
): string {
  const lines = [
    `Revise ${items.length} question(s) from "${params.topic}" (${SUBJECT_LABELS[params.subject as Subject] ?? params.subject}).`,
  ];
  if (params.instructions) {
    lines.push(`Standing instructions for this exam: ${params.instructions}`);
  }

  for (const item of items) {
    lines.push(
      "",
      `--- Question ${item.number} (id: ${item.id}, type: ${item.type}) ---`,
      "Current version:",
      JSON.stringify(item.current, null, 2),
      "Teacher's instruction:",
      item.instruction,
    );
  }

  lines.push(
    "",
    `Return all ${items.length} revised question(s), each with its original id.`,
  );
  return lines.join("\n");
}
