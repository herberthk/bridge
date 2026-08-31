/**
 * LaTeX repair and plain-text projection for AI-generated question content.
 *
 * One implementation, three call sites:
 *  • `generateExam` runs `repairMath` over every prompt, option and pair before
 *    the Firestore write, so newly generated exams are stored clean.
 *  • `<Markdown>` runs it again at render time, so the exams already sitting in
 *    the database display correctly without being regenerated.
 *  • `QuestionVisualView` runs `mathifyCell` over table headers and cells, which
 *    is the only reason a header reading `\sum x^2` ever rendered as those eight
 *    literal characters instead of ∑x².
 *
 * The failure it exists for: the model is asked for LaTeX and mostly obliges,
 * but a piecewise definition comes back as a bare brace group —
 * `$f(x) = {kx(2-x), 0 \le x \le 2, 0, \text{otherwise}$` — or as an inline
 * `cases` block cramped inside a sentence, or where conditions were dropped or
 * orphaned outside as unstyled text underneath the formula. Nothing downstream can
 * recover it unless repaired here, because by then the exam is stored and a
 * student is looking at it.
 *
 * Everything here is pure and dependency-free on purpose: it is imported by a
 * server service, by client components, and by a `environment: "node"` Vitest
 * suite, so it must not reach for the DOM, Firestore or KaTeX itself.
 */

/* ── scanning primitives ─────────────────────────────────────── */

/** True when the character at `i` is preceded by an odd run of backslashes. */
function isEscaped(text: string, i: number): boolean {
  let slashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === "\\"; j -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/**
 * Distinguishes maths from prose that merely contains a dollar sign. An
 * unterminated `$` is ambiguous — "the fee is $5 per term" is not a broken math
 * span — so an unclosed delimiter is only closed when what follows it actually
 * looks like maths.
 */
const MATH_SIGNAL = /\\[a-zA-Z]+|\\\\|[\^_][{(]|[\^_][A-Za-z0-9]/;

/**
 * Cell text is judged more conservatively than a prompt: a table column called
 * `total_sales` must stay prose, while `\sum x`, `x^2` and `H_2O` must become
 * maths. So a bare `_` between letters is not a signal; `_` before a digit or a
 * group is.
 */
const CELL_MATH_SIGNAL = /\\[a-zA-Z]+|\^[{(\-\d]|\^[A-Za-z]\b|_\{|_\d/;

/** Environments that are only legible centred on their own line. */
const DISPLAY_ENV =
  /\\begin\{(?:cases|aligned|align\*?|array|split|gather\*?|[bBpvV]?matrix)\}/;

/** Markers that make a fragment a *condition* rather than a *value* in a piecewise definition. */
const CONDITION =
  /\\l(?:e|eq|t)\b|\\g(?:e|eq|t)\b|\\neq?\b|\\in\b|\\text\s*\{\s*(?:otherwise|elsewhere|else|if|when)|\b(?:otherwise|elsewhere|else|if|when)\b|[<>≤≥≠]/i;

/** Fenced blocks and inline code are markdown, not maths, and are passed through untouched. */
const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Splits on `separators` that sit at brace/paren/bracket depth zero, so
 * `\frac{1}{8}, x > 3` splits into two parts and `f(x, y)` into one.
 */
function splitTopLevel(body: string, separators: readonly string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (isEscaped(body, i)) continue;
    const ch = body[i]!;
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    for (const sep of separators) {
      if (body.startsWith(sep, i)) {
        parts.push(body.slice(start, i));
        i += sep.length - 1;
        start = i + 1;
        break;
      }
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/* ── piecewise reconstruction ────────────────────────────────── */

/** Renders `otherwise`/`else` upright, the way an examiner would set it. */
function textualize(condition: string): string {
  let res = condition.replace(
    /(^|[^\\{a-zA-Z])(otherwise|elsewhere|else)\b/gi,
    (_m, lead: string, word: string) => `${lead}\\text{${word}}`,
  );
  // Clean up any double \text{\text{...}}
  res = res.replace(/\\text\{\\text\{([^}]+)\}\}/g, "\\text{$1}");
  return res.trim();
}

/**
 * Cleans one row intended for a cases environment, ensuring value and condition
 * are separated by `&` and words like `otherwise` are textualized.
 */
function cleanCasesRow(row: string): string {
  const trimmed = row.trim();
  if (!trimmed) return "";
  if (trimmed.includes("&")) {
    return textualize(trimmed.replace(/[,;]\s*(?=&)/g, " ").replace(/\s+&/, " &"));
  }

  // Comma-separated value and condition: `kx(2-x), 0 \le x \le 2`
  const commaParts = splitTopLevel(trimmed, [","]);
  const lastCommaPart = commaParts[commaParts.length - 1];
  if (commaParts.length >= 2 && lastCommaPart && CONDITION.test(lastCommaPart)) {
    commaParts.pop();
    return `${commaParts.join(", ").trim()} & ${textualize(lastCommaPart)}`;
  }

  // Semicolon-separated: `kx(2-x); 0 \le x \le 2`
  const semiParts = splitTopLevel(trimmed, [";"]);
  const lastSemiPart = semiParts[semiParts.length - 1];
  if (semiParts.length >= 2 && lastSemiPart && CONDITION.test(lastSemiPart)) {
    semiParts.pop();
    return `${semiParts.join("; ").trim()} & ${textualize(lastSemiPart)}`;
  }

  // Suffix condition with `\text{otherwise}` or `otherwise`
  if (/\b(?:\\text\s*\{\s*(?:otherwise|elsewhere|else)\s*\}|otherwise|elsewhere|else)\b/i.test(trimmed)) {
    const match = /(?:[,;]|\s+)?(\\text\s*\{\s*(?:otherwise|elsewhere|else)\s*\}|\b(?:otherwise|elsewhere|else)\b.*$)/i.exec(trimmed);
    if (match && match.index > 0) {
      const val = trimmed.slice(0, match.index).trim();
      const cond = match[1]!.trim();
      if (val) return `${val} & ${textualize(cond)}`;
    }
  }

  // Separated by `\quad` or `\qquad` before a condition: `kx(2-x) \quad 0 \le x \le 2`
  const quadMatch = /^(.*?)(?:\\qquad|\\quad|\s{2,})([^\\]*(?:\\le|\\ge|<|>|\\in|\\text|otherwise|≤|≥).*)$/i.exec(trimmed);
  if (quadMatch && quadMatch[1] && quadMatch[2] && CONDITION.test(quadMatch[2])) {
    return `${quadMatch[1].trim()} & ${textualize(quadMatch[2].trim())}`;
  }

  return trimmed;
}

/**
 * Turns the comma-separated soup inside a bare brace group into `cases` rows.
 * Returns null when the content does not read as a piecewise definition, which
 * is the signal to leave the maths exactly as the model wrote it.
 */
function casesRows(inner: string): string | null {
  const rows: string[] = [];
  const byRow = splitTopLevel(inner, ["\\\\"]);

  if (byRow.length > 1) {
    // The model already separated the cases; clean each row.
    for (const row of byRow) {
      rows.push(cleanCasesRow(row));
    }
  } else {
    // One flat list: values and conditions alternate, and only the conditions
    // are identifiable, so they are what drives the pairing.
    let pending: string | null = null;
    for (const part of splitTopLevel(inner, [","])) {
      if (pending !== null && CONDITION.test(part)) {
        rows.push(`${pending} & ${textualize(part)}`);
        pending = null;
        continue;
      }
      if (pending !== null) rows.push(pending);
      pending = part;
    }
    if (pending !== null) rows.push(pending);
  }

  // Two branches and at least one recognised condition, or this was a group we
  // had no business rewriting.
  if (rows.length < 2 || !rows.some((r) => r.includes("&"))) return null;
  return ` ${rows.join(" \\\\ ")} `;
}

/**
 * Normalizes existing `\begin{cases}` environments and array/matrix equivalents,
 * ensuring each row carries `&` before its condition.
 */
function repairExistingCases(body: string): string {
  // Normalize \left\{ \begin{matrix|array|aligned} ... \end{...} to \begin{cases}...\end{cases}
  let out = body.replace(
    /\\(?:left\s*)?\\\{\s*\\begin\{(?:matrix|array|aligned)\}(?:\{[lrc| ]*\})?([\s\S]*?)\\end\{(?:matrix|array|aligned)\}\s*(?:\\right[.]?)?/g,
    (_m, inner: string) => `\\begin{cases}${inner}\\end{cases}`,
  );

  // Normalize rows inside \begin{cases}...\end{cases}
  out = out.replace(
    /\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g,
    (m, inner: string) => {
      const rows = splitTopLevel(inner, ["\\\\"]);
      if (rows.length === 0) return m;
      const repairedRows = rows.map(cleanCasesRow);
      return `\\begin{cases} ${repairedRows.join(" \\\\ ")} \\end{cases}`;
    },
  );

  return out;
}

/**
 * Rewrites `f(x) = {…}` or `f(x) = \{…\}` as `f(x) = \begin{cases}…\end{cases}`.
 *
 * Only a group opened immediately after a definition operator is considered. Any
 * other `{` is an argument to a command — `\frac{1}{2}`, `x^{n+1}` — and
 * rewriting one of those would corrupt maths that renders perfectly well.
 */
function toCases(body: string): string {
  const normalized = repairExistingCases(body);
  if (/\\begin\{cases\}/.test(normalized)) return normalized;

  const open = /(?:=|:=|\\coloneqq)\s*(?:\\left\s*)?(?:\\{|\\lbrace|(?<!\\)\{)/.exec(normalized);
  if (!open) return normalized;

  const braceAt = open.index + open[0].length - 1;
  const isBackslashEscaped = open[0].includes("\\{") || open[0].includes("\\lbrace");

  let depth = 0;
  let closeAt = -1;
  for (let i = braceAt; i < normalized.length; i += 1) {
    if (normalized.startsWith("\\right.", i) || normalized.startsWith("\\right\\}", i)) {
      closeAt = i;
      break;
    }
    if (isEscaped(normalized, i) && !isBackslashEscaped) continue;
    const ch = normalized[i]!;
    if (ch === "{" || (isBackslashEscaped && normalized.startsWith("\\{", i))) {
      depth += 1;
      if (isBackslashEscaped && normalized.startsWith("\\{", i)) i += 1;
      continue;
    }
    if (ch === "}" || (isBackslashEscaped && normalized.startsWith("\\}", i))) {
      depth -= 1;
      if (depth === 0) {
        closeAt = i;
        break;
      }
      if (isBackslashEscaped && normalized.startsWith("\\}", i)) i += 1;
    }
  }

  // A missing close is the common case, not an edge case: it is what breaks the
  // render in the first place.
  const innerStart = braceAt + 1;
  const inner = normalized.slice(innerStart, closeAt === -1 ? normalized.length : closeAt);
  const tail = closeAt === -1 ? "" : normalized.slice(closeAt + 1);
  const rows = casesRows(inner);
  if (!rows) return normalized;
  const prefix = normalized
    .slice(0, open.index + open[0].length)
    .replace(/(?:\\left\s*)?(?:\\{|\\lbrace|(?<!\\)\{)$/, "");
  return `${prefix}\\begin{cases}${rows}\\end{cases}${tail}`;
}

/* ── structural balancing ────────────────────────────────────── */

function balanceEnvironments(body: string): string {
  let out = body;
  for (const match of body.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)) {
    const env = match[1]!;
    const name = env.replace(/\*/g, "\\*");
    const begins = countMatches(out, new RegExp(`\\\\begin\\{${name}\\}`, "g"));
    const ends = countMatches(out, new RegExp(`\\\\end\\{${name}\\}`, "g"));
    for (let k = ends; k < begins; k += 1) out += `\\end{${env}}`;
  }
  return out;
}

function balanceLeftRight(body: string): string {
  // `(?![a-zA-Z])` so `\leftarrow` is not counted as a `\left`.
  const lefts = countMatches(body, /\\left(?![a-zA-Z])/g);
  const rights = countMatches(body, /\\right(?![a-zA-Z])/g);
  if (lefts === rights) return body;
  return lefts > rights
    ? body + "\\right.".repeat(lefts - rights)
    : "\\left.".repeat(rights - lefts) + body;
}

function balanceBraces(body: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (isEscaped(body, i)) {
      out += ch;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      out += ch;
      continue;
    }
    if (ch === "}") {
      // A close with nothing open is KaTeX's "Expected group after"; dropping it
      // renders the rest of the expression instead of losing all of it.
      if (depth === 0) continue;
      depth -= 1;
    }
    out += ch;
  }
  return depth > 0 ? out + "}".repeat(depth) : out;
}

/** Repairs one math span's body — everything between the delimiters. */
function repairMathBody(raw: string): string {
  let body = raw.trim();
  if (!body) return body;
  body = toCases(body);
  body = balanceEnvironments(body);
  body = balanceLeftRight(body);
  body = balanceBraces(body);
  // A row separator immediately before `\end` produces a blank final row.
  body = body.replace(/\\\\\s*(?=\\end\{)/g, "");
  return body.trim();
}

/* ── span rewriting ──────────────────────────────────────────── */

function rewriteMathSpans(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "$" || isEscaped(text, i)) {
      out += ch;
      i += 1;
      continue;
    }

    const display = text[i + 1] === "$";
    const openLen = display ? 2 : 1;
    let close = -1;
    for (let j = i + openLen; j < text.length; j += 1) {
      if (text[j] === "$" && !isEscaped(text, j)) {
        if (!display || text[j + 1] === "$") {
          close = j;
          break;
        }
      }
      // Inline maths never spans a blank line; treating it as if it did would
      // swallow the rest of the question.
      if (!display && text[j] === "\n" && text[j + 1] === "\n") break;
    }

    if (close === -1) {
      const brk = text.indexOf("\n\n", i + openLen);
      const limit = brk === -1 ? text.length : brk;
      const tail = text.slice(i + openLen, limit);
      if (!MATH_SIGNAL.test(tail)) {
        // A currency amount or a stray delimiter. `remark-math` already leaves an
        // unpaired `$` as text, so the safe repair is to change nothing.
        out += ch;
        i += 1;
        continue;
      }
      const repaired = repairMathBody(tail);
      const shouldDisplay = display || DISPLAY_ENV.test(repaired) || repaired.includes("\\\\");
      const fence = shouldDisplay ? "\n\n$$" : "$";
      const closeFence = shouldDisplay ? "$$\n\n" : "$";
      out += repaired ? `${fence}${repaired}${closeFence}` : text.slice(i, limit);
      i = limit;
      continue;
    }

    const repaired = repairMathBody(text.slice(i + openLen, close));
    const shouldDisplay = display || DISPLAY_ENV.test(repaired) || repaired.includes("\\\\");
    const fence = shouldDisplay ? "\n\n$$" : "$";
    const closeFence = shouldDisplay ? "$$\n\n" : "$";
    out += repaired ? `${fence}${repaired}${closeFence}` : text.slice(i, close + openLen);
    i = close + openLen;
  }
  return out;
}

/**
 * Recovers piecewise definitions where the model closed `\end{cases}` around values
 * alone, leaving conditions orphaned outside on subsequent lines or following spans.
 *
 * Example failure:
 *   `$f(x) = \begin{cases} kx(2-x), \\ 0, \end{cases}$ $0 \le x \le 2$ $\text{otherwise}$`
 * Transformed to:
 *   `$$f(x) = \begin{cases} kx(2-x) & 0 \le x \le 2 \\ 0 & \text{otherwise} \end{cases}$$`
 */
function stitchOrphanedPiecewise(text: string): string {
  // Pattern matching a cases definition inside delimiters
  const pattern = /(?:\$\$|\$|\\\[)\s*([a-zA-Z]\w*(?:\([^)]*\))?\s*(?:=|:=|\\coloneqq)\s*\\begin\{cases\}([\s\S]*?)\\end\{cases\})\s*(?:\$\$|\$|\\\])([\s\S]*?)(?=(?:\n\s*\n|[A-Z][a-z]{2,}\b|\bFind\b|\bDetermine\b|\bCalculate\b|\bEvaluate\b|\bShow\b|\bWhat\b|\bWhere\b|$))/g;

  return text.replace(pattern, (fullMatch, formulaHead: string, innerCases: string, trailingText: string) => {
    const rawRows = splitTopLevel(innerCases, ["\\\\"])
      .map((r) => r.trim().replace(/[,;]+$/, "").trim())
      .filter((r) => r.length > 0);

    // If rows already contain `&` or recognised conditions, this cases block is not orphaned.
    if (rawRows.length < 2 || rawRows.some((r) => r.includes("&")) || rawRows.some((r) => CONDITION.test(r))) {
      return fullMatch;
    }

    // Look for condition tokens in trailingText
    const condSegments = trailingText
      .split(/[\n,;]|(?<=\$)\s*(?=\$)/)
      .map((s) => s.replace(/\$/g, "").trim())
      .filter((s) => s.length > 0 && CONDITION.test(s));

    if (condSegments.length === rawRows.length) {
      const pairedRows = rawRows.map((val, idx) => `${val} & ${textualize(condSegments[idx]!)}`);
      const eqSignIndex = formulaHead.indexOf("\\begin{cases}");
      const prefix = eqSignIndex !== -1 ? formulaHead.slice(0, eqSignIndex).trim() : "";

      // Strip consumed conditions from trailingText
      let remainingTrailing = trailingText;
      for (const cond of condSegments) {
        remainingTrailing = remainingTrailing.replace(new RegExp(`\\\$?\\s*${cond.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\\$?`, "i"), "");
      }
      remainingTrailing = remainingTrailing.replace(/^\s*[,;.]\s*/, "").trim();

      return `\n\n$$${prefix} \\begin{cases} ${pairedRows.join(" \\\\ ")} \\end{cases}$$\n\n${remainingTrailing ? `${remainingTrailing} ` : ""}`;
    }

    return fullMatch;
  });
}

/**
 * Formats sequential steps, cases, or methods in explanations and worked examples
 * with clean paragraph breaks and bold step headings.
 *
 * Example:
 *   "Step 1: Symmetry gives E(X) = 3. Step 2: Let u = x - 3. Step 3: Integrate."
 * Transformed to:
 *   "**Step 1:** Symmetry gives E(X) = 3.\n\n**Step 2:** Let u = x - 3.\n\n**Step 3:** Integrate."
 */
function formatPedagogicalProse(text: string): string {
  let out = text;

  // Format `Step N:`, `Step N.`, `Method N:`, `Case N:` at the start of a sentence or step
  out = out.replace(
    /(?:^|\s+|\n)(Step|Method|Case|Part)\s+(\d+|[A-Za-z])(?:\s*[:.]\s*|\s*[-–—]\s*)/gi,
    (_match, kind: string, num: string) => {
      const title = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
      return `\n\n**${title} ${num}:** `;
    },
  );

  // If a question prompt or explanation has an equation introduction followed immediately by
  // a question command without a break, add a clean break
  out = out.replace(
    /(?<=\$\$|\$|\))\s+(Find|Determine|Calculate|Evaluate|Show that|State|What is|Hence,?\s+[a-z])/g,
    "\n\n$1",
  );

  return out;
}

function repairSegment(input: string): string {
  let normalized = input
    // `\[…\]` and `\(…\)` are display/inline intent that `remark-math` does not
    // recognise, so they reach the page as literal backslash-brackets.
    .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_m, b: string) => `\n\n$$${b.trim()}$$\n\n`)
    .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_m, b: string) => `$${b.trim()}$`);

  normalized = stitchOrphanedPiecewise(normalized);
  normalized = formatPedagogicalProse(normalized);
  const rewritten = rewriteMathSpans(normalized);

  // Ensure display math blocks are isolated and clean excessive newlines
  return rewritten.replace(/\n{3,}/g, "\n\n").trim();
}

/* ── public API ──────────────────────────────────────────────── */

/**
 * Repairs the maths in a markdown string. Idempotent, and a no-op for text that
 * contains none — so it is safe to run at generation time *and* again on render.
 */
export function repairMath(input: unknown): string {
  if (typeof input !== "string") return "";
  if (!input.includes("$") && !input.includes("\\") && !/(?:Step|Method|Case|Part)\s+(?:\d+|[A-Za-z])/i.test(input)) return input;
  return input
    .split(CODE_SPLIT)
    .map((part, idx) => (idx % 2 === 1 ? part : repairSegment(part ?? "")))
    .join("");
}

/**
 * Prepares one table header or cell for rendering.
 *
 * Table visuals are the one place the model reliably omits delimiters: it writes
 * `\sum x^2` in a "Statistic" column because the column is *about* notation, and
 * a raw string renderer then prints the backslash. Wrapping it restores the
 * symbol; leaving prose alone keeps `Frequency` from being italicised.
 */
export function mathifyCell(input: unknown): string {
  const cell = (typeof input === "string" ? input : String(input ?? "")).trim();
  if (!cell) return "";
  if (cell.includes("$")) return repairMath(cell);
  if (!CELL_MATH_SIGNAL.test(cell)) return cell;
  // `%` starts a LaTeX comment and `&` is an alignment tab; both silently eat the
  // rest of the cell once it is maths.
  const escaped = cell.replace(/(?<!\\)([%#&])/g, "\\$1");
  return repairMath(`$${escaped}$`);
}

const BLACKBOARD: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
};

const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  infty: "∞",
  times: "×",
  div: "÷",
  cdot: "·",
  ast: "∗",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  leqslant: "≤",
  ge: "≥",
  geq: "≥",
  geqslant: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  equiv: "≡",
  propto: "∝",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  rightarrow: "→",
  Rightarrow: "⇒",
  to: "→",
  mapsto: "↦",
  leftarrow: "←",
  Leftarrow: "⇐",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  partial: "∂",
  nabla: "∇",
  degree: "°",
  circ: "∘",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  therefore: "∴",
  because: "∵",
  sqrt: "√",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  prime: "′",
  bar: "",
  overline: "",
  hat: "",
  vec: "",
  left: "",
  right: "",
  quad: " ",
  qquad: " ",
  ",": " ",
  ";": " ",
};

const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

function toScript(value: string, digits: string, kind: "^" | "_"): string {
  const mapped: (string | null)[] = [...value].map((c) => {
    if (c >= "0" && c <= "9") return digits[Number(c)]!;
    if (c === "-") return kind === "^" ? "⁻" : "₋";
    if (c === "+") return kind === "^" ? "⁺" : "₊";
    if (c === "n" && kind === "^") return "ⁿ";
    return null;
  });
  return mapped.every((c) => c !== null) ? mapped.join("") : `${kind}${value}`;
}

/**
 * Projects markdown-with-LaTeX down to a single line of readable plain text.
 *
 * For the places that cannot run KaTeX: SVG axis ticks and chart legends, the
 * one-line question summaries in the results view, and `aria-label`s. Those used
 * to strip `$`, `*` and `\` characters, turning this into "sum x2".
 */
export function plainMath(input: unknown): string {
  if (typeof input !== "string" || !input) return "";
  let out = input;

  out = out.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1");
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Delimiters vanish rather than becoming spaces: `Find $k$.` must not become
  // `Find k .`.
  out = out.replace(/\\\[|\\\]|\\\(|\\\)/g, " ").replace(/\$\$?/g, "");
  out = out.replace(/\\begin\{[a-zA-Z*]+\}|\\end\{[a-zA-Z*]+\}/g, " ");
  out = out.replace(
    /\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathsf|operatorname)\s*\{([^{}]*)\}/g,
    "$1",
  );
  out = out.replace(/\\mathbb\s*\{([A-Z])\}/g, (_m, l: string) => BLACKBOARD[l] ?? l);
  out = out.replace(
    /\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
    (_m, a: string, b: string) =>
      `${a.length > 1 ? `(${a})` : a}/${b.length > 1 ? `(${b})` : b}`,
  );
  out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, a: string) => `√${a.length > 1 ? `(${a})` : a}`);
  out = out.replace(/\^\{([^{}]*)\}/g, (_m, v: string) => toScript(v, SUPERSCRIPTS, "^"));
  out = out.replace(/\^(-?[0-9n])/g, (_m, v: string) => toScript(v, SUPERSCRIPTS, "^"));
  out = out.replace(/_\{([^{}]*)\}/g, (_m, v: string) => toScript(v, SUBSCRIPTS, "_"));
  out = out.replace(/_(-?[0-9])/g, (_m, v: string) => toScript(v, SUBSCRIPTS, "_"));
  out = out.replace(/\\\\/g, " ");
  // A space after a command name is LaTeX's name terminator, not a space in the
  // output: `\sum x^2` is ∑x², not ∑ x². Relations get their spacing back below,
  // where it aids reading rather than following the typesetting rules.
  out = out.replace(/\\([a-zA-Z]+|[,;])[ ]?/g, (_m, name: string) => SYMBOLS[name] ?? " ");
  out = out.replace(/([≤≥≠≈≡∝∈∉⊂⊆⊃∪∩→⇒↦←⇐↔⇔±∓])/g, " $1 ");
  out = out.replace(/[{}&]/g, " ");
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s{0,3}>\s?/gm, "");
  out = out.replace(/(?<![\w\\])_([^_\n]+)_(?![\w])/g, "$1");
  out = out.replace(/(\*\*|__|~~|\*)/g, "").replace(/(\w)_(\w)/g, "$1$2");
  out = out.replace(/^\s{0,3}[-*+]\s+/gm, "").replace(/\|/g, " ");

  return out.replace(/\s+/g, " ").trim();
}

/** Plain-text projection, cut to `max` characters on a word boundary. */
export function summarizeQuestion(input: unknown, max = 120): string {
  const text = plainMath(input);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
