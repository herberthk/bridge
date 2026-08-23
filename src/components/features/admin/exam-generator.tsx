"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpenIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  SparklesIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";

import { examParamsSchema, type ExamParamsInput } from "@/lib/schemas/exam";
import {
  COUNTRY_CURRICULA,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  PRIMARY_CLASSES,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  SECONDARY_SUBJECTS_BY_SUB_LEVEL,
  SUB_LEVEL_LABELS,
  SUBJECT_LABELS,
  SUBJECT_SUBSIDIARIES,
  SUBSIDIARY_LABELS,
  type Subject,
} from "@/lib/constants";
import { classLevelOptions } from "@/lib/schemas/users";
import {
  estimateGenerationTokens,
  formatUgx,
  formatUsd,
  tokensToUsd,
  usdToUgx,
} from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface UploadedDoc {
  documentId: string;
  name: string;
  parseStatus: "pending" | "parsed" | "failed";
  uploading: boolean;
}

import type { z } from "zod";

/** Form shape before zod applies defaults. */
type FormValues = z.input<typeof examParamsSchema>;

export function ExamGenerator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    examId: string;
    title: string;
    questions: number;
    tokensUsed: number;
  } | null>(null);

  // Prefill from the voice builder's "Continue to generator" hand-off.
  const voice = readVoiceParams(searchParams);

  const form = useForm<FormValues, unknown, ExamParamsInput>({
    resolver: zodResolver(examParamsSchema),
    defaultValues: {
      subject: voice.subject,
      level: voice.level,
      secondarySubLevel: voice.level === "secondary" ? voice.subLevel : null,
      classLevel: voice.classLevel,
      topic: voice.topic,
      subsidiary: voice.subsidiary,
      difficulty: voice.difficulty,
      durationMinutes: voice.durationMinutes,
      questionCount: voice.questionCount,
      questionTypes: voice.questionTypes,
      includeHints: true,
      includeExplanations: true,
      includeWorkedExamples: false,
      instructions: null,
    },
  });

  const level = form.watch("level");
  const subLevel = form.watch("secondarySubLevel") ?? "o_level";
  const subject = form.watch("subject");
  const questionCount = form.watch("questionCount");
  const subjects =
    level === "primary"
      ? COUNTRY_CURRICULA.UG.primary
      : SECONDARY_SUBJECTS_BY_SUB_LEVEL[subLevel];
  const needsSubsidiary = Boolean(
    SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES],
  );

  const estimate = useMemo(
    () => estimateGenerationTokens(questionCount, docs.some((d) => !d.uploading)),
    [questionCount, docs],
  );

  const onDrop = async (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setDocs((prev) => [
        ...prev,
        { documentId: id, name: file.name, parseStatus: "pending", uploading: true },
      ]);
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/documents", { method: "POST", body: fd });
        const data = (await res.json().catch(() => null)) as
          | { ok: true; documentId: string; parseStatus: "parsed" | "failed" }
          | { error: string }
          | null;
        if (!res.ok || !data || !("ok" in data)) {
          toast.error(data && "error" in data ? data.error : `Upload failed: ${file.name}`);
          setDocs((prev) => prev.filter((d) => d.documentId !== id));
          return;
        }
        setDocs((prev) =>
          prev.map((d) =>
            d.documentId === id
              ? { ...d, documentId: data.documentId, parseStatus: data.parseStatus, uploading: false }
              : d,
          ),
        );
        if (data.parseStatus === "failed") {
          toast.warning(`Couldn't read text from ${file.name} — it will be skipped as source material.`);
        }
      } catch {
        toast.error(`Upload failed: ${file.name}`);
        setDocs((prev) => prev.filter((d) => d.documentId !== id));
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    },
    maxSize: 50 * 1024 * 1024,
    disabled: generating,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setGenerating(true);
    setResult(null);
    try {
      const res = await fetch("/api/exams/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params: { ...values, instructions: values.instructions || null },
          documentIds: docs.filter((d) => !d.uploading && d.parseStatus === "parsed").map((d) => d.documentId),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; examId: string; title: string; questions: number; tokensUsed: number }
        | { error: string }
        | null;
      if (!res.ok || !data || !("ok" in data)) {
        toast.error(data && "error" in data ? data.error : "Generation failed.");
        return;
      }
      setResult(data);
      toast.success("Exam generated!", {
        description: `${data.questions} questions · ${data.tokensUsed.toLocaleString()} tokens`,
      });
      router.refresh();
    } catch {
      toast.error("Network error — check your connection and retry.");
    } finally {
      setGenerating(false);
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpenIcon className="size-4" />
                Curriculum
              </CardTitle>
              <CardDescription>What should the exam cover?</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel>Level</FieldLabel>
                    <Controller
                      control={form.control}
                      name="level"
                      render={({ field }) => (
                        <ToggleGroup
                          value={[field.value]}
                          onValueChange={(v: readonly string[]) => {
                            const next = v[0] as "primary" | "secondary" | undefined;
                            if (!next) return;
                            field.onChange(next);
                            if (next === "primary") {
                              form.setValue("secondarySubLevel", null);
                              form.setValue("subsidiary", null);
                              form.setValue("classLevel", 5);
                              if (
                                !(
                                  COUNTRY_CURRICULA.UG.primary as readonly string[]
                                ).includes(form.getValues("subject"))
                              ) {
                                form.setValue("subject", COUNTRY_CURRICULA.UG.primary[0]);
                              }
                            } else {
                              const sub =
                                form.getValues("secondarySubLevel") === "a_level"
                                  ? "a_level"
                                  : "o_level";
                              form.setValue("secondarySubLevel", sub);
                              form.setValue("classLevel", sub === "a_level" ? 5 : 2);
                              if (
                                !(
                                  SECONDARY_SUBJECTS_BY_SUB_LEVEL[sub] as readonly string[]
                                ).includes(form.getValues("subject"))
                              ) {
                                form.setValue(
                                  "subject",
                                  SECONDARY_SUBJECTS_BY_SUB_LEVEL[sub][0] as FormValues["subject"],
                                );
                              }
                            }
                          }}
                          className="flex"
                        >
                          <ToggleGroupItem value="primary" className="flex-1">
                            Primary
                          </ToggleGroupItem>
                          <ToggleGroupItem value="secondary" className="flex-1">
                            Secondary
                          </ToggleGroupItem>
                        </ToggleGroup>
                      )}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="classLevel">Class</FieldLabel>
                    <Controller
                      control={form.control}
                      name="classLevel"
                      render={({ field }) => (
                        <Select
                          value={String(field.value)}
                          onValueChange={(v) => field.onChange(Number(v))}
                        >
                          <SelectTrigger id="classLevel">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {classLevelOptions(level, subLevel).map((opt) => (
                              <SelectItem key={opt.value} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                </div>

                {level === "secondary" && (
                  <Controller
                    control={form.control}
                    name="secondarySubLevel"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel>Secondary sub-level</FieldLabel>
                        <ToggleGroup
                          value={[field.value ?? "o_level"]}
                          onValueChange={(v: readonly string[]) => {
                            const next = v[0] as "o_level" | "a_level" | undefined;
                            if (!next) return;
                            field.onChange(next);
                            // Snap the class into the new band and re-filter subjects.
                            form.setValue("classLevel", next === "a_level" ? 5 : 2);
                            if (
                              !(
                                SECONDARY_SUBJECTS_BY_SUB_LEVEL[next] as readonly string[]
                              ).includes(form.getValues("subject"))
                            ) {
                              form.setValue(
                                "subject",
                                SECONDARY_SUBJECTS_BY_SUB_LEVEL.o_level[0] as FormValues["subject"],
                              );
                            }
                          }}
                          className="flex"
                        >
                          <ToggleGroupItem value="o_level" className="flex-1">
                            {SUB_LEVEL_LABELS.o_level}
                          </ToggleGroupItem>
                          <ToggleGroupItem value="a_level" className="flex-1">
                            {SUB_LEVEL_LABELS.a_level}
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </Field>
                    )}
                  />
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field data-invalid={form.formState.errors.subject ? true : undefined}>
                    <FieldLabel htmlFor="subject">Subject</FieldLabel>
                    <Controller
                      control={form.control}
                      name="subject"
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={(v) => {
                            field.onChange(v);
                            const subs = SUBJECT_SUBSIDIARIES[v as keyof typeof SUBJECT_SUBSIDIARIES];
                            if (!subs) form.setValue("subsidiary", null);
                          }}
                        >
                          <SelectTrigger id="subject">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {subjects.map((s) => (
                              <SelectItem key={s} value={s}>
                                {SUBJECT_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {form.formState.errors.subject && (
                      <FieldError>{form.formState.errors.subject.message}</FieldError>
                    )}
                  </Field>
                  <Field data-invalid={form.formState.errors.topic ? true : undefined}>
                    <FieldLabel htmlFor="topic">Topic / theme</FieldLabel>
                    <Input
                      id="topic"
                      placeholder="e.g. Linear equations & word problems"
                      aria-invalid={!!form.formState.errors.topic}
                      {...form.register("topic")}
                    />
                    {form.formState.errors.topic && (
                      <FieldError>{form.formState.errors.topic.message}</FieldError>
                    )}
                  </Field>
                </div>

                {needsSubsidiary && (
                  <Field data-invalid={form.formState.errors.subsidiary ? true : undefined}>
                    <FieldLabel htmlFor="subsidiary">
                      {SUBJECT_SUBSIDIARIES[subject as keyof typeof SUBJECT_SUBSIDIARIES]?.label}
                    </FieldLabel>
                    <Controller
                      control={form.control}
                      name="subsidiary"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? ""}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger id="subsidiary">
                            <SelectValue placeholder="Choose the branch" />
                          </SelectTrigger>
                          <SelectContent>
                            {SUBJECT_SUBSIDIARIES[
                              subject as keyof typeof SUBJECT_SUBSIDIARIES
                            ]!.options.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {SUBSIDIARY_LABELS[opt] ?? opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {form.formState.errors.subsidiary ? (
                      <FieldError>
                        {form.formState.errors.subsidiary.message}
                      </FieldError>
                    ) : (
                      <FieldDescription>
                        Questions will focus strictly on the chosen branch.
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SparklesIcon className="size-4" />
                Format &amp; difficulty
              </CardTitle>
              <CardDescription>Shape of the assessment.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={form.formState.errors.questionTypes ? true : undefined}>
                  <FieldLabel>Question types</FieldLabel>
                  <Controller
                    control={form.control}
                    name="questionTypes"
                    render={({ field }) => (
                      <ToggleGroup
                        value={field.value}
                        onValueChange={(v: readonly string[]) =>
                          field.onChange(v as ExamParamsInput["questionTypes"])
                        }
                        className="flex flex-wrap justify-start"
                      >
                        {QUESTION_TYPES.map((t) => (
                          <ToggleGroupItem key={t} value={t}>
                            {QUESTION_TYPE_LABELS[t]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  />
                  {form.formState.errors.questionTypes && (
                    <FieldError>{form.formState.errors.questionTypes.message}</FieldError>
                  )}
                </Field>

                <Field data-invalid={form.formState.errors.difficulty ? true : undefined}>
                  <FieldLabel>Difficulty</FieldLabel>
                  <Controller
                    control={form.control}
                    name="difficulty"
                    render={({ field }) => (
                      <ToggleGroup
                        value={[field.value]}
                        onValueChange={(v: readonly string[]) => {
                          if (v[0]) field.onChange(v[0]);
                        }}
                        className="flex"
                      >
                        {DIFFICULTIES.map((d) => (
                          <ToggleGroupItem key={d} value={d} className="flex-1">
                            {DIFFICULTY_LABELS[d]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="questionCount">
                      Questions:{" "}
                      <span className="text-foreground font-semibold">{questionCount}</span>
                    </FieldLabel>
                    <Controller
                      control={form.control}
                      name="questionCount"
                      render={({ field }) => (
                        <Slider
                          id="questionCount"
                          min={1}
                          max={100}
                          step={1}
                          value={[field.value]}
                          onValueChange={(v) => field.onChange((Array.isArray(v) ? v[0] : v) ?? field.value)}
                        />
                      )}
                    />
                    <FieldDescription>1–100 questions per exam.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="durationMinutes">
                      Duration:{" "}
                      <span className="text-foreground font-semibold">
                        {form.watch("durationMinutes")} min
                      </span>
                    </FieldLabel>
                    <Controller
                      control={form.control}
                      name="durationMinutes"
                      render={({ field }) => (
                        <Slider
                          id="durationMinutes"
                          min={5}
                          max={240}
                          step={5}
                          value={[field.value]}
                          onValueChange={(v) => field.onChange((Array.isArray(v) ? v[0] : v) ?? field.value)}
                        />
                      )}
                    />
                    <FieldDescription>Countdown is enforced server-side.</FieldDescription>
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["includeHints", "Hints"],
                      ["includeExplanations", "Explanations"],
                      ["includeWorkedExamples", "Worked examples"],
                    ] as const
                  ).map(([name, label]) => (
                    <Field key={name}>
                      <label
                        htmlFor={name}
                        className="hover:bg-accent/50 flex h-14 cursor-pointer items-center justify-between rounded-lg border px-4 transition-colors"
                      >
                        <span className="text-sm font-medium">{label}</span>
                        <Controller
                          control={form.control}
                          name={name}
                          render={({ field }) => (
                            <Switch
                              id={name}
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          )}
                        />
                      </label>
                    </Field>
                  ))}
                </div>

                <Field>
                  <FieldLabel htmlFor="instructions">
                    Special instructions (optional)
                  </FieldLabel>
                  <Textarea
                    id="instructions"
                    rows={2}
                    placeholder="e.g. Focus on past-paper style word problems, avoid geometry."
                    {...form.register("instructions")}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadCloudIcon className="size-4" />
                Source material (optional)
              </CardTitle>
              <CardDescription>
                Upload past papers, textbook sections, or notes — the AI builds
                the exam from them. PDF, DOCX, TXT up to 50 MB.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div
                {...getRootProps()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                  isDragActive
                    ? "border-primary bg-accent/50"
                    : "hover:border-primary/50 hover:bg-accent/30"
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloudIcon className="text-muted-foreground size-8" />
                <p className="text-sm font-medium">
                  {isDragActive ? "Drop files here…" : "Drag & drop or click to upload"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Questions will be grounded on your material
                </p>
              </div>

              <ul className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {docs.map((d) => (
                    <motion.li
                      key={d.documentId}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2"
                    >
                      <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                      {d.uploading ? (
                        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                      ) : d.parseStatus === "parsed" ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2Icon className="size-3" /> Ready
                        </Badge>
                      ) : (
                        <Badge variant="outline">Unreadable</Badge>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${d.name}`}
                        onClick={() => setDocs((prev) => prev.filter((x) => x.documentId !== d.documentId))}
                      >
                        <XIcon />
                      </Button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Sticky action rail */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card className="overflow-hidden">
            <div className="bg-brand-soft text-accent-foreground flex flex-col gap-1 p-5">
              <p className="text-sm font-medium">Estimated cost</p>
              <p className="text-3xl font-semibold tabular-nums">
                {formatUsd(tokensToUsd(estimate))}
              </p>
              <p className="text-muted-foreground text-sm">
                ≈ {formatUgx(usdToUgx(tokensToUsd(estimate)))} · ~
                {estimate.toLocaleString()} tokens
              </p>
            </div>
            <CardContent className="flex flex-col gap-4 p-5">
              <p className="text-muted-foreground text-sm">
                Final billing uses actual token usage from Gemini. You&apos;ll
                see the exact figure after generation.
              </p>
              <Separator />
              <Button
                type="submit"
                size="lg"
                className="shadow-glow h-11 w-full"
                disabled={generating || docs.some((d) => d.uploading)}
              >
                {generating ? (
                  <>
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <SparklesIcon data-icon="inline-start" />
                    Generate exam
                  </>
                )}
              </Button>

              <AnimatePresence>
                {generating && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-muted space-y-2 rounded-lg p-4">
                      <div className="bg-shimmer bg-primary/10 h-2 rounded-full" />
                      <p className="text-muted-foreground text-xs">
                        Gemini is drafting questions calibrated to your class
                        level and difficulty…
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4"
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2Icon className="size-4" />
                    {result.title}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {result.questions} questions ·{" "}
                    {result.tokensUsed.toLocaleString()} tokens used
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => router.push("/admin/exams")}
                  >
                    Open exam library
                  </Button>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

/** Parse the voice builder's query-param hand-off. */
function readVoiceParams(sp: ReadonlyURLSearchParams) {
  const level = (sp.get("level") as "primary" | "secondary" | null) ?? "secondary";
  const subLevel =
    level === "secondary"
      ? ((sp.get("sublevel") as "o_level" | "a_level" | null) ?? "o_level")
      : null;
  const types = sp.get("types")?.split(",").filter(Boolean);
  return {
    level,
    subLevel,
    subject: (sp.get("subject") as FormValues["subject"] | null) ?? "mathematics",
    classLevel: Number(sp.get("classLevel")) || (subLevel === "a_level" ? 5 : level === "primary" ? 5 : 2),
    topic: sp.get("topic") ?? "",
    subsidiary: sp.get("subsidiary") || null,
    difficulty: (sp.get("difficulty") as FormValues["difficulty"] | null) ?? "medium",
    durationMinutes: Number(sp.get("duration")) || 45,
    questionCount: Number(sp.get("count")) || 20,
    questionTypes: (types?.length
      ? types
      : ["multiple_choice", "short_answer"]) as FormValues["questionTypes"],
  };
}
