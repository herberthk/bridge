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
 * `$f(x) = {kx(2-x), 0 \le x \le 2, 0, \text{otherwise}$` — rather than as
 * `\begin{cases}`. KaTeX reads `{` as the start of a group that is never closed,
 * so the whole span fails and the conditions land underneath the formula as
 * unstyled text. Nothing downstream can recover it, because by then the exam is
 * stored and a student is looking at it.
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
  /\\l(?:e|eq|t)\b|\\g(?:e|eq|t)\b|\\neq?\b|\\in\b|\\text\s*\{\s*(?:otherwise|elsewhere|else)|\botherwise\b|\belsewhere\b|[<>≤≥≠]/i;

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
  return condition.replace(
    /(^|[^\\{a-zA-Z])(otherwise|elsewhere|else)\b/gi,
    (_m, lead: string, word: string) => `${lead}\\text{${word}}`,
  );
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
    // The model already separated the cases; it just never opened the environment.
    for (const row of byRow) {
      if (row.includes("&")) {
        rows.push(row.replace(/,\s*(?=&)/, " "));
        continue;
      }
      const parts = splitTopLevel(row, [","]);
      const last = parts[parts.length - 1];
      if (parts.length >= 2 && last && CONDITION.test(last)) {
        parts.pop();
        rows.push(`${parts.join(", ")} & ${textualize(last)}`);
        continue;
      }
      rows.push(row);
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
 * Rewrites `f(x) = {…}` as `f(x) = \begin{cases}…\end{cases}`.
 *
 * Only a group opened immediately after a definition operator is considered. Any
 * other `{` is an argument to a command — `\frac{1}{2}`, `x^{n+1}` — and
 * rewriting one of those would corrupt maths that renders perfectly well.
 */
function toCases(body: string): string {
  if (/\\begin\{/.test(body)) return body;
  const open = /(?:=|:=|\\coloneqq)\s*\{/.exec(body);
  if (!open) return body;

  const braceAt = open.index + open[0].length - 1;
  let depth = 0;
  let closeAt = -1;
  for (let i = braceAt; i < body.length; i += 1) {
    if (isEscaped(body, i)) continue;
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        closeAt = i;
        break;
      }
    }
  }

  // A missing close is the common case, not an edge case: it is what breaks the
  // render in the first place.
  const inner = body.slice(braceAt + 1, closeAt === -1 ? body.length : closeAt);
  const tail = closeAt === -1 ? "" : body.slice(closeAt + 1);
  const rows = casesRows(inner);
  if (!rows) return body;
  return `${body.slice(0, braceAt)}\\begin{cases}${rows}\\end{cases}${tail}`;
}

/* ── structural balancing ────────────────────────────────────── */

function balanceEnvironments(body: string): string {
  let out = body;
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
      const fence = display ? "$$" : "$";
      out += repaired ? `${fence}${repaired}${fence}` : text.slice(i, limit);
      i = limit;
      continue;
    }

    const repaired = repairMathBody(text.slice(i + openLen, close));
    const fence = display ? "$$" : "$";
    out += repaired ? `${fence}${repaired}${fence}` : text.slice(i, close + openLen);
    i = close + openLen;
  }
  return out;
}

/**
 * Promotes a formula that already occupies a whole line to display maths.
 *
 * `remark-math` only produces block maths when `$$` opens a line, so a `cases`
 * matrix written as `$…$` renders at inline size and cramped. Restricting the
 * promotion to lines that hold nothing else keeps sentence-embedded maths inline
 * where it belongs.
 */
function promoteStandaloneDisplay(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length < 4 || !trimmed.startsWith("$") || trimmed.startsWith("$$")) return line;
      if (!trimmed.endsWith("$")) return line;
      const body = trimmed.slice(1, -1);
      if (body.includes("$")) return line; // two spans on one line
      if (!DISPLAY_ENV.test(body) && !body.includes("\\\\")) return line;
      return `\n$$${body}$$\n`;
    })
    .join("\n");
}

function repairSegment(input: string): string {
  const normalized = input
    // `\[…\]` and `\(…\)` are display/inline intent that `remark-math` does not
    // recognise, so they reach the page as literal backslash-brackets.
    .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_m, b: string) => `\n\n$$${b.trim()}$$\n\n`)
    .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_m, b: string) => `$${b.trim()}$`);
  return promoteStandaloneDisplay(rewriteMathSpans(normalized));
}

/* ── public API ──────────────────────────────────────────────── */

/**
 * Repairs the maths in a markdown string. Idempotent, and a no-op for text that
 * contains none — so it is safe to run at generation time *and* again on render.
 */
export function repairMath(input: unknown): string {
  if (typeof input !== "string") return "";
  if (!input.includes("$") && !input.includes("\\")) return input;
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
 * to strip `$`, `*` and `\` characters, which turned `$\sum x^2$` into
 * `sum x2` — the same information loss the renderer was fixed to avoid.
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
