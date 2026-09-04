"use client";

import { memo, useDeferredValue, useLayoutEffect, useMemo, useRef, useId } from "react";

import { Markdown } from "@/components/markdown";
import { useExamSession } from "@/stores/exam-session";
import {
  continueListOnEnter,
  countWords,
  shouldPreviewAnswer,
} from "@/lib/exam/answer-format";
import { cn } from "@/lib/utils";

/**
 * Structured answer editor for essay + short-answer questions.
 *
 * One auto-growing textarea with a WhatsApp-style live preview underneath:
 * `- item` renders as a bullet, `1. item` as a numbered list, `$…$` as maths,
 * all inside the same card so writing and reading feel like one input. The
 * preview only appears once there is structure worth typesetting (see
 * `shouldPreviewAnswer`), so single-line answers never echo back at the student.
 *
 * Performance notes:
 * - `memo` + reading `setAnswer` straight from the store: the runner
 *   re-renders every second for its countdown, but with a stable `value` this
 *   editor (and its KaTeX tree) bails out of all of those.
 * - The preview renders a `useDeferredValue` snapshot, so fast typing never
 *   blocks on KaTeX — React yields first, typesets after.
 * - Auto-grow is one `scrollHeight` read/write per change inside rAF; no
 *   observers, no per-keystroke timers.
 *
 * The store keeps the raw markdown text, which is exactly what results review
 * (`answerMarkdown` → `Markdown`) and AI grading already consume.
 */
export const AnswerEditor = memo(function AnswerEditor({
  questionId,
  value,
  variant,
  label,
  placeholder,
}: {
  questionId: string;
  value: string;
  variant: "compact" | "full";
  label: string;
  placeholder: string;
}) {
  const setAnswer = useExamSession((s) => s.setAnswer);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const hintId = useId();

  const full = variant === "full";
  const minHeight = full ? 160 : 76;
  const maxHeight = full ? 360 : 180;

  // Auto-grow *and* contract: resetting to `auto` first lets long deletions
  // shrink the box again instead of pinning it at its tallest ever height.
  // rAF keeps the measure/write pair out of the keystroke's critical path.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.style.height = "auto";
      el.style.height = `${Math.max(Math.min(el.scrollHeight, maxHeight), minHeight)}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [value, minHeight, maxHeight]);

  // Restore the caret after a programmatic list continuation.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const el = areaRef.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    const raf = requestAnimationFrame(() => {
      el?.setSelectionRange(caret, caret);
      el?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const deferred = useDeferredValue(value);
  const showPreview = shouldPreviewAnswer(deferred);
  const words = useMemo(() => countWords(value), [value]);

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-card focus-within:ring-2 focus-within:ring-primary/30">
      <textarea
        ref={areaRef}
        rows={full ? 6 : 3}
        value={value}
        aria-label={label}
        aria-describedby={hintId}
        placeholder={placeholder}
        onChange={(e) => setAnswer(questionId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const el = e.currentTarget;
          if (el.selectionStart !== el.selectionEnd) return;
          const next = continueListOnEnter(el.value, el.selectionStart);
          if (!next) return;
          e.preventDefault();
          pendingCaret.current = next.caret;
          setAnswer(questionId, next.text);
        }}
        className={cn(
          "block w-full resize-none overflow-y-auto bg-transparent outline-none placeholder:text-muted-foreground",
          full ? "px-4 pb-3 pt-4 text-[15px] leading-relaxed" : "px-4 pb-2.5 pt-3.5 text-sm leading-relaxed",
        )}
        style={{ minHeight, maxHeight }}
      />

      {showPreview && (
        <div className="border-t bg-muted/25 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Formatted preview
          </p>
          {/* Not a live region on purpose: announcing every keystroke would
              talk over the student while they type. */}
          <div className="mt-1.5 text-sm leading-relaxed">
            <Markdown className="prose-bridge">{deferred}</Markdown>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-4 py-2">
        <p id={hintId} className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground/70">- </span>bullets
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-semibold text-foreground/70">1. </span>numbering
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-semibold text-foreground/70">$…$ </span>maths
          <span className="mx-1.5 opacity-40">·</span>
          Enter continues · empty Enter exits
        </p>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </div>
  );
});
