import { describe, expect, it } from "vitest";

import { mathifyCell, plainMath, repairMath, summarizeQuestion } from "@/lib/exam/latex";

/**
 * These cases are transcriptions of what a live 60-question A-level Maths paper
 * actually rendered, not invented malformations.
 *
 * Two of them are the reason this module exists. A probability density function
 * came back as a bare brace group instead of `\begin{cases}`, so KaTeX failed the
 * span and the conditions dropped underneath the formula as unstyled text; the
 * matching CDF did the same with three branches. The third — a "Bivariate Sample
 * Statistics" table whose Statistic column read `\sum x`, `\sum y`, `\sum x^2`
 * verbatim — is `mathifyCell`'s.
 */

/** Verbatim from the rendered paper: question 6 of 60, a density function. */
const PDF_PROMPT =
  "A continuous random variable $X$ has probability density function " +
  "$f(x) = {kx(2-x), 0 \\le x \\le 2, 0, \\text{otherwise}$. Find the value of $k$.";

/** Question 14 of the same paper: a three-branch cumulative distribution function. */
const CDF_PROMPT =
  "$F(x) = {0, x < 1, \\frac{x^2-1}{8}, 1 \\le x \\le 3, 1, x > 3$";

describe("repairMath: piecewise definitions", () => {
  it("rebuilds a density function as a cases environment", () => {
    const out = repairMath(PDF_PROMPT);
    expect(out).toContain("\\begin{cases}");
    expect(out).toContain("\\end{cases}");
    // The value/condition pairing is the whole point: a `cases` block with the
    // ampersands in the wrong places is aligned nonsense rather than a function.
    expect(out).toContain("kx(2-x) & 0 \\le x \\le 2");
    expect(out).toContain("0 & \\text{otherwise}");
    // Everything around the formula survives untouched.
    expect(out).toContain("A continuous random variable $X$ has");
    expect(out).toContain("Find the value of $k$.");
  });

  it("keeps all three branches of a CDF in order", () => {
    const out = repairMath(CDF_PROMPT);
    const rows = out.slice(out.indexOf("cases}") + 6, out.indexOf("\\end{cases}")).split("\\\\");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("x < 1");
    expect(rows[1]).toContain("\\frac{x^2-1}{8}");
    expect(rows[1]).toContain("1 \\le x \\le 3");
    expect(rows[2]).toContain("x > 3");
  });

  it("pairs cases the model separated with row breaks but never opened", () => {
    const out = repairMath("$f(x) = {x^2, & x \\ge 0 \\\\ -x^2, & x < 0$");
    expect(out).toContain("\\begin{cases}");
    expect(out).toContain("x^2 & x \\ge 0");
    expect(out).not.toContain("x^2, & x \\ge 0");
    expect(out.match(/\\\\/g)).toHaveLength(1); // one row separator, not three
  });

  it("upgrades a standalone cases formula to display maths", () => {
    // `remark-math` only emits block maths when `$$` opens a line, so a cases
    // matrix left in `$…$` renders at inline size and cramped.
    const out = repairMath(`Given:\n\n${CDF_PROMPT}\n\nFind $F(2)$.`);
    expect(out).toContain("$$F(x) = \\begin{cases}");
    expect(out).toContain("\\end{cases}$$");
    // Inline maths in a sentence stays inline.
    expect(out).toContain("Find $F(2)$.");
  });

  it("leaves a correctly written cases block exactly as it is", () => {
    const good =
      "$$f(x) = \\begin{cases} kx(2-x) & 0 \\le x \\le 2 \\\\ 0 & \\text{otherwise} \\end{cases}$$";
    expect(repairMath(good)).toBe(good);
  });

  it("recovers cases with orphaned trailing conditions (live screenshot regression)", () => {
    const broken =
      "A continuous random variable $X$ has a probability density function given by: " +
      "$f(x) = \\begin{cases} kx(2-x), \\\\ 0, \\end{cases}$ $0 \\le x \\le 2$ $\\text{otherwise}$ " +
      "Determine the exact value of $\\text{Var}(3X-2)$.";
    const out = repairMath(broken);
    expect(out).toContain("\\begin{cases}");
    expect(out).toContain("kx(2-x) & 0 \\le x \\le 2");
    expect(out).toContain("0 & \\text{otherwise}");
    expect(out).toContain("\\end{cases}");
    expect(out).toContain("A continuous random variable $X$ has");
    expect(out).toContain("Determine the exact value of $\\text{Var}(3X-2)$.");
  });

  it("repairs cases whose rows omit the ampersand before the condition", () => {
    const missingAmpersands =
      "$$f(x) = \\begin{cases} kx(2-x), 0 \\le x \\le 2 \\\\ 0, \\text{otherwise} \\end{cases}$$";
    const out = repairMath(missingAmpersands);
    expect(out).toContain("kx(2-x) & 0 \\le x \\le 2");
    expect(out).toContain("0 & \\text{otherwise}");
  });

  it("textualizes conditions in rows that already contain an ampersand", () => {
    const out = repairMath(
      "$$f(x) = \\begin{cases} x & x > 0 \\\\ 0 & otherwise \\end{cases}$$",
    );
    expect(out).toContain("0 & \\text{otherwise}");
  });

  it("converts \\left\\{ \\begin{matrix} piecewise definitions to cases", () => {
    const matrixDef =
      "$f(x) = \\left\\{ \\begin{matrix} kx(2-x) & 0 \\le x \\le 2 \\\\ 0 & \\text{otherwise} \\end{matrix} \\right.$";
    const out = repairMath(matrixDef);
    expect(out).toContain("\\begin{cases}");
    expect(out).toContain("kx(2-x) & 0 \\le x \\le 2");
    expect(out).toContain("0 & \\text{otherwise}");
    expect(out).toContain("\\end{cases}");
  });

  it("handles escaped brace piecewise definitions with \\{", () => {
    const escapedBrace =
      "$f(x) = \\{ kx(2-x), 0 \\le x \\le 2 \\\\ 0, \\text{otherwise}$";
    const out = repairMath(escapedBrace);
    expect(out).toContain("\\begin{cases}");
    expect(out).toContain("kx(2-x) & 0 \\le x \\le 2");
    expect(out).toContain("0 & \\text{otherwise}");
    expect(out).toContain("\\end{cases}");
  });

  it("promotes sentence-embedded cases to display math blocks (latest screenshot regression)", () => {
    const prompt =
      "A continuous random variable $X$ has the probability density function: " +
      "$f(x) = \\begin{cases} \\frac{3}{32}(x-1)(5-x) & 1 \\le x \\le 5 \\\\ 0 & \\text{otherwise} \\end{cases}$ " +
      "Determine the exact value of $\\text{Var}(X)$.";
    const out = repairMath(prompt);
    expect(out).toContain("$$f(x) = \\begin{cases}");
    expect(out).toContain("\\end{cases}$$");
    expect(out).toContain("A continuous random variable $X$ has");
    expect(out).toContain("Determine the exact value of $\\text{Var}(X)$.");
    // Ensure display block is isolated by newlines
    expect(out).toMatch(/\n\n\$\$f\(x\)/);
  });

  it("formats worked example steps with bold step titles and paragraph breaks", () => {
    const rawSteps =
      "Step 1: By symmetry, E(X) = 3. Step 2: Let u = x - 3, so x = u + 3 and -2 <= u <= 2. Step 3: Var(X) = E(u^2). Step 4: Finish.";
    const out = repairMath(rawSteps);
    expect(out).toContain("**Step 1:**");
    expect(out).toContain("**Step 2:**");
    expect(out).toContain("**Step 3:**");
    expect(out).toContain("**Step 4:**");
    expect(out).toContain("\n\n**Step 2:**");
    expect(out).toContain("\n\n**Step 3:**");
  });

  it("formats alphabetic step and part headings without maths", () => {
    const out = repairMath("Part A: Establish the result. Step B: Apply it.");
    expect(out).toContain("**Part A:** Establish the result.");
    expect(out).toContain("**Step B:** Apply it.");
  });

  it("does not rewrite a brace group that is an argument, not a definition", () => {
    // The dangerous false positive: every `\frac`, `^{}` and `_{}` in the paper is
    // a brace group following something, and rewriting one corrupts working maths.
    const fine = "The gradient is $m = \\frac{y_2 - y_1}{x_2 - x_1}$ at $x^{n+1}$.";
    expect(repairMath(fine)).toBe(fine);
  });

  it("does not invent cases from a set definition", () => {
    // `A = {1, 2, 3}` is a set, not a piecewise function: no conditions, so the
    // group is balanced and left alone.
    const set = "Let $A = \\{1, 2, 3\\}$ and $B = \\{2, 4\\}$.";
    expect(repairMath(set)).toBe(set);
  });
});

describe("repairMath: structural balance", () => {
  it("closes an unbalanced group rather than losing the expression", () => {
    expect(repairMath("$\\frac{1}{2$")).toBe("$\\frac{1}{2}$");
  });

  it("drops a close brace that has nothing open", () => {
    expect(repairMath("$x + 1}$")).toBe("$x + 1$");
  });

  it("closes \\left with \\right. and vice versa", () => {
    expect(repairMath("$\\left( \\frac{a}{b}$")).toBe("$\\left( \\frac{a}{b}\\right.$");
    expect(repairMath("$\\frac{a}{b} \\right)$")).toBe("$\\left.\\frac{a}{b} \\right)$");
  });

  it("does not count \\leftarrow as an unclosed \\left", () => {
    const arrow = "$a \\leftarrow b$";
    expect(repairMath(arrow)).toBe(arrow);
  });

  it("closes an environment the model opened and abandoned", () => {
    const out = repairMath("$$\\begin{aligned} x &= 2 \\\\ y &= 3$$");
    expect(out).toBe("$$\\begin{aligned} x &= 2 \\\\ y &= 3\\end{aligned}$$");
  });

  it("removes a trailing row separator that would render as a blank row", () => {
    const out = repairMath("$$\\begin{aligned} x &= 2 \\\\ \\end{aligned}$$");
    expect(out).toBe("$$\\begin{aligned} x &= 2 \\end{aligned}$$");
  });
});

describe("repairMath: delimiters", () => {
  it("converts \\(…\\) to inline maths", () => {
    expect(repairMath("The area is \\(\\pi r^2\\) exactly.")).toBe(
      "The area is $\\pi r^2$ exactly.",
    );
  });

  it("converts \\[…\\] to display maths on its own line", () => {
    const out = repairMath("Show that\\[\\int_0^1 x^2 dx = \\frac{1}{3}\\]holds.");
    expect(out).toContain("$$\\int_0^1 x^2 dx = \\frac{1}{3}$$");
    expect(out).toMatch(/\n\n\$\$/);
  });

  it("does not treat escaped backslashes as math delimiters", () => {
    const displayRowBreak = String.raw`Line break \\[6pt] before a literal \\] marker.`;
    const inlineRowBreak = String.raw`Line break \\(x before a literal \\) marker.`;
    expect(repairMath(displayRowBreak)).toBe(displayRowBreak);
    expect(repairMath(inlineRowBreak)).toBe(inlineRowBreak);
  });

  it("closes an unterminated span when what follows is maths", () => {
    const out = repairMath("Evaluate $\\int_0^2 x\\,dx");
    expect(out).toBe("Evaluate $\\int_0^2 x\\,dx$");
  });

  it("leaves an unpaired dollar alone when it is money, not maths", () => {
    // `remark-math` already renders a lone `$` as text; closing it would wrap the
    // rest of the sentence in a formula.
    const money = "The termly fee is $5 and rises each year.";
    expect(repairMath(money)).toBe(money);
  });

  it("never reaches into code spans or fences", () => {
    const code = "Use `f(x) = {a, b` in the shell, then:\n\n```\nx = {1\n```\n";
    expect(repairMath(code)).toBe(code);
  });
});

describe("repairMath: safety at the edges", () => {
  it("is idempotent, because generation and render both run it", () => {
    for (const input of [PDF_PROMPT, CDF_PROMPT, "$\\frac{1}{2$", "\\(x^2\\)"]) {
      const once = repairMath(input);
      expect(repairMath(once)).toBe(once);
    }
  });

  it("passes prose through untouched and never throws on junk", () => {
    expect(repairMath("Name two causes of soil erosion.")).toBe(
      "Name two causes of soil erosion.",
    );
    expect(repairMath("")).toBe("");
    expect(repairMath(null)).toBe("");
    expect(repairMath(42)).toBe("");
    expect(repairMath("$$")).toBe("$$");
  });

  it("leaves markdown tables and lists in the prompt alone", () => {
    const table = "| Year | Yield |\n| --- | --- |\n| 2019 | 40 |\n\n1. First\n2. Second";
    expect(repairMath(table)).toBe(table);
  });
});

describe("mathifyCell", () => {
  it("wraps notation the model wrote without delimiters", () => {
    // The Statistic column of the bivariate table, which reached the student as
    // eight literal characters.
    expect(mathifyCell("\\sum x^2")).toBe("$\\sum x^2$");
    expect(mathifyCell("\\sum xy")).toBe("$\\sum xy$");
    expect(mathifyCell("x^2")).toBe("$x^2$");
    expect(mathifyCell("H_2O")).toBe("$H_2O$");
  });

  it("leaves ordinary cell text as text", () => {
    for (const plain of ["Frequency", "Region", "40", "12.5", "n/a", "50%", "total_sales"]) {
      expect(mathifyCell(plain)).toBe(plain);
    }
  });

  it("escapes characters that would eat the rest of the cell once it is maths", () => {
    // `%` opens a LaTeX comment, so an unescaped one silently deletes everything
    // after it; `&` is an alignment tab.
    expect(mathifyCell("\\sigma = 5%")).toBe("$\\sigma = 5\\%$");
    expect(mathifyCell("\\sum x & y")).toBe("$\\sum x \\& y$");
  });

  it("repairs a cell that already carries delimiters", () => {
    expect(mathifyCell("$\\frac{1}{2$")).toBe("$\\frac{1}{2}$");
    expect(mathifyCell("  $\\bar{x}$  ")).toBe("$\\bar{x}$");
  });

  it("is idempotent and total", () => {
    const once = mathifyCell("\\sum x^2");
    expect(mathifyCell(once)).toBe(once);
    expect(mathifyCell("")).toBe("");
    expect(mathifyCell(null)).toBe("");
    expect(mathifyCell(40)).toBe("40");
  });
});

describe("plainMath", () => {
  it("renders notation as symbols for contexts that cannot run KaTeX", () => {
    // SVG axis ticks, chart legends and `aria-label`s. The old approach stripped
    // `$`, `*` and `\` characters, turning this into "sum x2".
    expect(plainMath("$\\sum x^2$")).toBe("∑x²");
    expect(plainMath("$\\frac{1}{2}$")).toBe("1/2");
    expect(plainMath("$\\frac{x^2-1}{8}$")).toBe("(x²-1)/8");
    expect(plainMath("$\\sqrt{x}$ and $\\pi r^2$")).toBe("√x and πr²");
    expect(plainMath("$x \\le 2$, $\\theta \\ne 0$")).toBe("x ≤ 2, θ ≠ 0");
    expect(plainMath("$\\mathbb{R}$")).toBe("ℝ");
  });

  it("flattens a cases block to something readable on one line", () => {
    const out = plainMath(
      "$$f(x) = \\begin{cases} kx(2-x) & 0 \\le x \\le 2 \\\\ 0 & \\text{otherwise} \\end{cases}$$",
    );
    expect(out).toBe("f(x) = kx(2-x) 0 ≤ x ≤ 2 0 otherwise");
  });

  it("strips markdown without eating the words", () => {
    expect(plainMath("**Given** the _data_ in `table 1`:")).toBe("Given the data in table 1:");
    expect(plainMath("## Section\n- one\n- two")).toBe("Section one two");
  });

  it("is total", () => {
    expect(plainMath("")).toBe("");
    expect(plainMath(null)).toBe("");
    expect(plainMath(undefined)).toBe("");
  });
});

describe("summarizeQuestion", () => {
  it("cuts on a word boundary and marks the cut", () => {
    const out = summarizeQuestion(PDF_PROMPT, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("A continuous random variable X has")).toBe(true);
    expect(out).not.toContain("  ");
  });

  it("returns short text unchanged", () => {
    expect(summarizeQuestion("Find $k$.")).toBe("Find k.");
  });
});
