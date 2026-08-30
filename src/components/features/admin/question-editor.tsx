"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  validatedQuestionPatchSchema,
  type QuestionPatchInput,
} from "@/lib/schemas/exam-review";
import type { Question } from "@/types/firestore";

/** The shape being typed into. Nothing here is nullable except the two answer keys. */
interface Draft {
  prompt: string;
  options: string[];
  correctOptionIndex: number | null;
  correctBool: boolean | null;
  acceptableAnswers: string[];
  pairs: { left: string; right: string }[];
  points: number;
  hint: string;
  explanation: string;
  workedExample: string;
}

function toDraft(q: Question): Draft {
  return {
    prompt: q.prompt,
    // One blank row to type into, so adding an option is not a two-click job.
    options: q.options?.length ? [...q.options] : q.type === "multiple_choice" ? ["", "", "", ""] : [],
    correctOptionIndex: q.correctOptionIndex,
    correctBool: q.correctBool,
    acceptableAnswers: q.acceptableAnswers?.length ? [...q.acceptableAnswers] : [""],
    pairs: q.pairs?.length ? q.pairs.map((p) => ({ ...p })) : [{ left: "", right: "" }],
    points: q.points,
    hint: q.hint ?? "",
    explanation: q.explanation ?? "",
    workedExample: q.workedExample ?? "",
  };
}

/**
 * Drop blank option rows and follow the answer key through the shift.
 *
 * A trailing empty row is normal while editing, but it must never reach the store:
 * a student would be shown a lettered option with nothing in it. If the key pointed
 * at a row that is being dropped it becomes null, which the schema then reports as
 * "Mark which option is correct" — the honest outcome, rather than silently moving
 * the correct answer to a neighbouring option.
 */
function compactOptions(options: string[], correct: number | null) {
  const kept: string[] = [];
  let nextCorrect: number | null = null;
  options.forEach((raw, i) => {
    const value = raw.trim();
    if (value.length === 0) return;
    if (i === correct) nextCorrect = kept.length;
    kept.push(value);
  });
  return { options: kept, correctOptionIndex: nextCorrect };
}

/**
 * Build the patch the server will receive.
 *
 * Only the fields the question's type actually uses are included, plus the prose
 * fields every type has. An omitted key means "leave it alone" on the server, so
 * sending `acceptableAnswers: []` for a multiple-choice question would wipe a field
 * the editor never showed — and would register as a change in the review log.
 */
function toPatch(question: Question, draft: Draft): QuestionPatchInput {
  const patch: QuestionPatchInput = {
    id: question.id,
    type: question.type,
    prompt: draft.prompt.trim(),
    points: draft.points,
    hint: draft.hint.trim() || null,
    explanation: draft.explanation.trim() || null,
    workedExample: draft.workedExample.trim() || null,
  };

  if (question.type === "multiple_choice") {
    const compact = compactOptions(draft.options, draft.correctOptionIndex);
    patch.options = compact.options;
    patch.correctOptionIndex = compact.correctOptionIndex;
  }
  if (question.type === "true_false") {
    patch.correctBool = draft.correctBool;
  }
  if (question.type === "fill_in_the_blank" || question.type === "short_answer") {
    patch.acceptableAnswers = draft.acceptableAnswers
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  }
  if (question.type === "matching") {
    patch.pairs = draft.pairs
      .map((p) => ({ left: p.left.trim(), right: p.right.trim() }))
      .filter((p) => p.left.length > 0 && p.right.length > 0);
  }

  return patch;
}

/**
 * Edit one question by hand.
 *
 * Validation runs `validatedQuestionPatchSchema` — the same schema the server
 * applies — against the draft on every change, so the reviewer sees "mark which
 * option is correct" while they are still looking at the options, not after a
 * round trip that rejected the save.
 */
export function QuestionEditor({
  question,
  pending,
  onCancel,
  onSave,
}: {
  question: Question;
  pending: boolean;
  onCancel: () => void;
  onSave: (patch: QuestionPatchInput) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(question));
  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setDraft((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const patch = useMemo(() => toPatch(question, draft), [question, draft]);
  /** Field name → first message, so an error can sit under the control that caused it. */
  const errors = useMemo(() => {
    const parsed = validatedQuestionPatchSchema.safeParse(patch);
    if (parsed.success) return {} as Record<string, string>;
    const map: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      map[key] ??= issue.message;
    }
    return map;
  }, [patch]);
  const valid = Object.keys(errors).length === 0;

  // KaTeX on a long prompt is not free, and it should never be what makes typing
  // feel heavy. The preview lags the field by a frame or two instead.
  const previewPrompt = useDeferredValue(draft.prompt);

  const setOption = (i: number, value: string) =>
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((o, j) => (j === i ? value : o)),
    }));
  const removeOption = (i: number) =>
    setDraft((prev) => ({
      ...prev,
      options: prev.options.filter((_, j) => j !== i),
      // The key follows its option: removing a row above it shifts it down, and
      // removing the correct row itself leaves nothing marked.
      correctOptionIndex:
        prev.correctOptionIndex === null
          ? null
          : prev.correctOptionIndex === i
            ? null
            : prev.correctOptionIndex > i
              ? prev.correctOptionIndex - 1
              : prev.correctOptionIndex,
    }));

  return (
    <div className="flex flex-col gap-5">
      {/* ── Prompt ── */}
      <Field>
        <FieldLabel htmlFor={`prompt-${question.id}`}>Question</FieldLabel>
        <Textarea
          id={`prompt-${question.id}`}
          value={draft.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          rows={4}
          maxLength={5000}
          className="font-mono text-[13px]"
        />
        <FieldDescription>
          Markdown, with <code>$…$</code> for inline maths and <code>$$…$$</code> for a
          display block.
          {question.type === "fill_in_the_blank" && (
            <>
              {" "}
              Mark the blank with <code>___</code>.
            </>
          )}
        </FieldDescription>
        <FieldMessage message={errors.prompt} />
      </Field>

      {draft.prompt.trim().length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-muted-foreground mb-2 text-[11px] font-medium uppercase tracking-wide">
            Preview
          </p>
          <Markdown className="prose-bridge text-sm">{previewPrompt}</Markdown>
        </div>
      )}

      <Separator />

      {/* ── Multiple choice: options + which one is right ── */}
      {question.type === "multiple_choice" && (
        <Field>
          <FieldLabel>Options — select the correct one</FieldLabel>
          <RadioGroup
            value={draft.correctOptionIndex === null ? "" : String(draft.correctOptionIndex)}
            onValueChange={(value) => set("correctOptionIndex", Number(value))}
            className="flex flex-col gap-2"
          >
            {draft.options.map((option, i) => (
              <div key={i} className="flex items-center gap-2">
                <RadioGroupItem
                  value={String(i)}
                  id={`opt-${question.id}-${i}`}
                  aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                  disabled={option.trim().length === 0}
                />
                <label
                  htmlFor={`opt-${question.id}-${i}`}
                  className="text-muted-foreground w-4 shrink-0 text-xs font-semibold"
                >
                  {String.fromCharCode(65 + i)}
                </label>
                <Input
                  value={option}
                  onChange={(e) => setOption(i, e.target.value)}
                  maxLength={500}
                  placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove option ${String.fromCharCode(65 + i)}`}
                  disabled={draft.options.length <= 2}
                  onClick={() => removeOption(i)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </RadioGroup>
          {draft.options.length < 8 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => set("options", [...draft.options, ""])}
            >
              <PlusIcon data-icon="inline-start" />
              Add option
            </Button>
          )}
          <FieldMessage message={errors.options ?? errors.correctOptionIndex} />
        </Field>
      )}

      {/* ── True / false ── */}
      {question.type === "true_false" && (
        <Field>
          <FieldLabel>Correct answer</FieldLabel>
          <RadioGroup
            value={draft.correctBool === null ? "" : String(draft.correctBool)}
            onValueChange={(value) => set("correctBool", value === "true")}
            className="flex gap-4"
          >
            {[
              { value: "true", label: "True" },
              { value: "false", label: "False" },
            ].map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem value={o.value} />
                {o.label}
              </label>
            ))}
          </RadioGroup>
          <FieldMessage message={errors.correctBool} />
        </Field>
      )}

      {/* ── Accepted answers ── */}
      {(question.type === "fill_in_the_blank" || question.type === "short_answer") && (
        <Field>
          <FieldLabel>Accepted answers</FieldLabel>
          <div className="flex flex-col gap-2">
            {draft.acceptableAnswers.map((answer, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={answer}
                  onChange={(e) =>
                    set(
                      "acceptableAnswers",
                      draft.acceptableAnswers.map((a, j) => (j === i ? e.target.value : a)),
                    )
                  }
                  maxLength={200}
                  placeholder={i === 0 ? "The expected answer" : "Another wording that counts"}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove accepted answer ${i + 1}`}
                  disabled={draft.acceptableAnswers.length <= 1}
                  onClick={() =>
                    set(
                      "acceptableAnswers",
                      draft.acceptableAnswers.filter((_, j) => j !== i),
                    )
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
          {draft.acceptableAnswers.length < 12 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => set("acceptableAnswers", [...draft.acceptableAnswers, ""])}
            >
              <PlusIcon data-icon="inline-start" />
              Add accepted answer
            </Button>
          )}
          <FieldDescription>
            Plain text only — these are matched against what the student types, so
            <code> 1.8</code> counts and <code>$\frac{"{9}{5}"}$</code> never will. Add every
            spelling and unit a correct student might write.
          </FieldDescription>
          <FieldMessage message={errors.acceptableAnswers} />
        </Field>
      )}

      {/* ── Matching pairs ── */}
      {question.type === "matching" && (
        <Field>
          <FieldLabel>Pairs</FieldLabel>
          <div className="flex flex-col gap-2">
            {draft.pairs.map((pair, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={pair.left}
                  onChange={(e) =>
                    set(
                      "pairs",
                      draft.pairs.map((p, j) => (j === i ? { ...p, left: e.target.value } : p)),
                    )
                  }
                  maxLength={200}
                  placeholder="Prompt"
                  className="flex-1"
                />
                <span className="text-muted-foreground shrink-0 text-xs">→</span>
                <Input
                  value={pair.right}
                  onChange={(e) =>
                    set(
                      "pairs",
                      draft.pairs.map((p, j) => (j === i ? { ...p, right: e.target.value } : p)),
                    )
                  }
                  maxLength={200}
                  placeholder="Match"
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove pair ${i + 1}`}
                  disabled={draft.pairs.length <= 2}
                  onClick={() => set("pairs", draft.pairs.filter((_, j) => j !== i))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
          {draft.pairs.length < 10 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => set("pairs", [...draft.pairs, { left: "", right: "" }])}
            >
              <PlusIcon data-icon="inline-start" />
              Add pair
            </Button>
          )}
          <FieldMessage message={errors.pairs} />
        </Field>
      )}

      {/* ── Marks ── */}
      <Field className="max-w-40">
        <FieldLabel htmlFor={`points-${question.id}`}>Marks</FieldLabel>
        <Input
          id={`points-${question.id}`}
          type="number"
          min={1}
          max={50}
          value={draft.points}
          onChange={(e) => {
            // An empty number input reads as "" → NaN, which would fail the schema
            // with "expected number". Hold the last valid value instead.
            const next = Number.parseInt(e.target.value, 10);
            set("points", Number.isFinite(next) ? next : 1);
          }}
        />
        <FieldMessage message={errors.points} />
      </Field>

      <Separator />

      {/* ── Teaching prose ── */}
      <Field>
        <FieldLabel htmlFor={`hint-${question.id}`}>Hint</FieldLabel>
        <Textarea
          id={`hint-${question.id}`}
          value={draft.hint}
          onChange={(e) => set("hint", e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Optional nudge shown if the student asks for help."
        />
        <FieldMessage message={errors.hint} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`explanation-${question.id}`}>Explanation</FieldLabel>
        <Textarea
          id={`explanation-${question.id}`}
          value={draft.explanation}
          onChange={(e) => set("explanation", e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Why the answer is what it is — shown after marking."
        />
        <FieldMessage message={errors.explanation} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`worked-${question.id}`}>Worked example</FieldLabel>
        <Textarea
          id={`worked-${question.id}`}
          value={draft.workedExample}
          onChange={(e) => set("workedExample", e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Optional step-by-step working."
        />
        <FieldMessage message={errors.workedExample} />
      </Field>

      {question.visual && (
        <p className="text-muted-foreground rounded-lg border bg-muted/20 p-2.5 text-xs">
          This question has a chart or table attached. It is kept as it is — use{" "}
          <span className="font-medium">Ask AI to change this question</span> to alter it.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!valid && (
          <Badge variant="outline" className="border-destructive/40 text-destructive mr-auto">
            {Object.keys(errors).length} thing
            {Object.keys(errors).length === 1 ? "" : "s"} to fix
          </Badge>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" disabled={pending || !valid} onClick={() => onSave(patch)}>
          {pending ? "Saving…" : "Save & approve"}
        </Button>
      </div>
    </div>
  );
}

function FieldMessage({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-destructive text-xs">{message}</p>;
}
