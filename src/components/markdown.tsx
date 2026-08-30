"use client";

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import { repairMath } from "@/lib/exam/latex";

/**
 * KaTeX is deliberately lenient here.
 *
 * `strict` defaults to warning-and-refusing on things a language model does
 * constantly — a literal `≤` or `θ` inside `$…$`, `\\` in inline maths — and a
 * refusal means the student sees the raw source instead of the formula. `throwOnError`
 * off keeps one bad span from taking the surrounding markdown with it, and
 * `errorColor` puts whatever does fail into the theme rather than KaTeX's default red.
 * `htmlAndMathml` is what lets a screen reader read the expression at all.
 */
const KATEX_OPTIONS = {
  throwOnError: false,
  strict: "ignore",
  output: "htmlAndMathml",
  errorColor: "var(--destructive)",
  /** Commands models reach for that KaTeX does not ship. */
  macros: {
    "\\degree": "^{\\circ}",
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\abs": "\\left|#1\\right|",
    "\\norm": "\\left\\|#1\\right\\|",
    "\\dd": "\\mathrm{d}",
  },
} as const;

const COMPONENTS: Components = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // A markdown table inside a question is frequently wider than the phone it is
  // read on, and a table that widens its own container pushes the whole exam
  // layout sideways. Scroll it in place instead.
  table: ({ node: _node, ...props }) => (
    <div className="my-3 w-full overflow-x-auto rounded-xl border bg-card">
      <table {...props} />
    </div>
  ),
};

/**
 * Markdown with GFM tables + LaTeX math ($…$ inline, $$…$$ display) via KaTeX.
 *
 * `repairMath` runs on every render, not only at generation time, because exams
 * generated before the storage-side repair existed are still in the database and
 * still being sat. It is idempotent, so content that was already cleaned on the
 * way in passes straight through.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const source = useMemo(() => repairMath(children), [children]);
  return (
    <div className={className ?? "prose-bridge"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX_OPTIONS]]}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
