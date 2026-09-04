/**
 * Pure helpers for the student's structured answer editor (essay + short answer).
 *
 * DOM-free on purpose: list continuation is string math that belongs in a
 * node-environment test suite, not behind a rendered textarea. The component in
 * `components/features/exam/answer-editor.tsx` owns the caret and the DOM; this
 * module owns every decision about what the text becomes.
 */

/** A continued list line, or null when Enter should behave normally. */
export interface ListContinuation {
  /** Full next textarea value. */
  text: string;
  /** Caret offset after the inserted marker (or the exited line start). */
  caret: number;
}

const BULLET_RE = /^(\s*)([-*•])(\s+)/;
const NUMBERED_RE = /^(\s*)(\d+)([.)])(\s+)/;

/**
 * What pressing Enter at `caret` (a collapsed cursor) should do.
 *
 * - On a non-empty list item: insert a newline plus the same bullet, or the
 *   next number (`1. ` → `2. `), and park the caret after it.
 * - On an empty list item (`- ` with nothing after it): remove the marker line
 *   and exit the list, so a second Enter always escapes.
 * - Anywhere else (or a ranged selection, or IME composition): null, meaning
 *   the browser's default newline stands.
 */
export function continueListOnEnter(value: string, caret: number): ListContinuation | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf("\n", safeCaret - 1) + 1;
  const nextBreak = value.indexOf("\n", safeCaret);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);

  const bullet = line.match(BULLET_RE);
  const numbered = bullet ? null : line.match(NUMBERED_RE);
  const match = bullet ?? numbered;
  if (!match) return null;

  const indent = match[1] ?? "";
  const body = line.slice(match[0].length);

  if (body.trim() === "") {
    // Empty marker — exit the list by deleting the marker line (and its break).
    const afterBreak = lineEnd < value.length ? lineEnd + 1 : lineEnd;
    return { text: value.slice(0, lineStart) + value.slice(afterBreak), caret: lineStart };
  }

  const marker = numbered
    ? `${indent}${Number(numbered[2]) + 1}${numbered[3]} `
    : `${indent}${bullet![2]} `;
  const insertAt = safeCaret;
  return {
    text: `${value.slice(0, insertAt)}\n${marker}${value.slice(insertAt)}`,
    caret: insertAt + 1 + marker.length,
  };
}

/**
 * Whether the live formatted preview earns its keep.
 *
 * A single plain line would render back identically, so the preview only shows
 * once there is structure worth typesetting: multiple lines, a list marker, or
 * `$…$` maths. Keeps short one-liners echo-free and skips KaTeX entirely.
 */
export function shouldPreviewAnswer(value: string): boolean {
  if (!value.trim()) return false;
  if (value.includes("\n")) return true;
  if (/(^|\n)\s*([-*•]|\d+[.)])\s+\S/.test(value)) return true;
  return value.includes("$");
}

/** Word count for the answer footer — whitespace-split, blanks ignored. */
export function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
