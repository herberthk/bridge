"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createGoogle } from "@ai-sdk/google";
import { experimental_useRealtime as useRealtime } from "@ai-sdk/react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  AudioLinesIcon,
  CheckCircle2Icon,
  Loader2Icon,
  MicIcon,
  PhoneOffIcon,
  SparklesIcon,
} from "lucide-react";

import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  SUBJECT_LABELS,
  type Difficulty,
  type QuestionType,
  type Subject,
} from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DraftSpec {
  subject?: Subject;
  level?: "primary" | "secondary";
  secondarySubLevel?: "o_level" | "a_level" | null;
  subsidiary?: string;
  classLevel?: number;
  topic?: string;
  difficulty?: Difficulty;
  durationMinutes?: number;
  questionCount?: number;
  questionTypes?: QuestionType[];
  hints?: boolean;
  explanations?: boolean;
  workedExamples?: boolean;
}

/** Client-side provider descriptor — auth flows through the server token. */
const googleClient = createGoogle({ apiKey: "voice-builder" });
const LIVE_MODEL =
  process.env.NEXT_PUBLIC_BRIDGE_MODEL_LIVE ?? "gemini-live-2.5-flash-native-audio";

export function VoiceBuilder() {
  const router = useRouter();
  const [spec, setSpec] = useState<DraftSpec>({});
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [billed, setBilled] = useState<number | null>(null);
  const billedRef = useRef(false);

  const realtime = useRealtime({
    model: googleClient.experimental_realtime(LIVE_MODEL),
    api: { token: "/api/voice/setup" },
    onToolCall: async ({ toolCall }) => {
      const args = toolCall.args as Record<string, unknown>;
      const ack = <T,>(value: T) => ({ ok: true, value });
      switch (toolCall.toolName) {
        case "setSubject":
          setSpec((s) => ({ ...s, subject: args.subject as Subject }));
          return ack(SUBJECT_LABELS[args.subject as Subject]);
        case "setLevel":
          setSpec((s) => ({
            ...s,
            level: args.level as "primary" | "secondary",
            secondarySubLevel:
              args.level === "secondary"
                ? ((args.subLevel as "o_level" | "a_level" | undefined) ??
                  (s.secondarySubLevel ?? "o_level"))
                : null,
            classLevel: args.classLevel as number,
          }));
          return ack(
            `Set to ${args.level}${args.level === "secondary" ? ` (${args.subLevel === "a_level" ? "A level" : "O level"})` : ""} class ${args.classLevel}`,
          );
        case "setSubsidiary":
          setSpec((s) => ({ ...s, subsidiary: args.subsidiary as string }));
          return ack(
            args.subsidiary === "african_history" ? "African History" : "European History",
          );
        case "setTopic":
          setSpec((s) => ({ ...s, topic: args.topic as string }));
          return ack(args.topic as string);
        case "setDifficulty":
          setSpec((s) => ({ ...s, difficulty: args.difficulty as Difficulty }));
          return ack(DIFFICULTY_LABELS[args.difficulty as Difficulty]);
        case "setDuration":
          setSpec((s) => ({ ...s, durationMinutes: args.minutes as number }));
          return ack(`${args.minutes} minutes`);
        case "setQuestionCount":
          setSpec((s) => ({ ...s, questionCount: args.count as number }));
          return ack(`${args.count} questions`);
        case "setQuestionTypes":
          setSpec((s) => ({ ...s, questionTypes: args.types as QuestionType[] }));
          return ack((args.types as QuestionType[]).map((t) => QUESTION_TYPE_LABELS[t]));
        case "setInclude": {
          setSpec((s) => ({
            ...s,
            hints: args.hints !== undefined ? (args.hints as boolean) : s.hints,
            explanations:
              args.explanations !== undefined
                ? (args.explanations as boolean)
                : s.explanations,
            workedExamples:
              args.workedExamples !== undefined
                ? (args.workedExamples as boolean)
                : s.workedExamples,
          }));
          return ack("Updated");
        }
        default:
          return { ok: false, error: "Unknown tool" };
      }
    },
  });

  const connected = realtime.status === "connected";

  const endSession = useCallback(async () => {
    if (sessionStart && !billedRef.current) {
      billedRef.current = true;
      const seconds = Math.round((Date.now() - sessionStart) / 1000);
      try {
        const res = await fetch("/api/voice/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok: true; minutes: number }
          | { error: string }
          | null;
        if (res.ok && data && "ok" in data) {
          setBilled(data.minutes);
          toast.success(
            `Voice session billed: ${data.minutes.toFixed(1)} min ($${(data.minutes * 0.08).toFixed(2)})`,
          );
        } else {
          toast.error(data && "error" in data ? data.error : "Billing failed.");
        }
      } catch {
        toast.error("Billing failed — check your connection.");
      }
    }
    await realtime.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStart, realtime.disconnect]);

  const startSession = useCallback(async () => {
    billedRef.current = false;
    setBilled(null);
    try {
      await realtime.connect();
      setSessionStart(Date.now());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      realtime.startAudioCapture(stream);
    } catch (err) {
      toast.error(
        "Could not start the voice session. Allow microphone access and ensure the API key is configured.",
      );
      console.error(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtime.connect, realtime.startAudioCapture]);

  const transcript = realtime.messages
    .filter((m) => m.role !== "system")
    .map((m) =>
      m.parts
        .map((p) => ("text" in p ? p.text : ""))
        .join("")
        .trim(),
    )
    .filter(Boolean);

  const specReady = Boolean(
    spec.subject &&
      spec.level &&
      spec.topic &&
      spec.questionCount &&
      (spec.subject !== "history" || spec.subsidiary),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Voice exam builder</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Talk to Bridge — describe the exam you want and watch the spec build
          live. Billed at $0.08/min from your school wallet.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Talk panel */}
        <Card className="overflow-hidden">
          <div className="bg-brand-soft relative flex h-72 flex-col items-center justify-center gap-5">
            {connected && (
              <div
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "radial-gradient(18rem 12rem at 50% 45%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 70%)",
                }}
              />
            )}
            <motion.button
              type="button"
              onClick={() => (connected ? void endSession() : void startSession())}
              aria-label={connected ? "End voice session" : "Start voice session"}
              animate={
                connected
                  ? { scale: [1, 1.06, 1], boxShadow: "0 0 0 0 rgba(79,70,229,0.35)" }
                  : { scale: 1 }
              }
              transition={connected ? { repeat: Infinity, duration: 1.8 } : {}}
              className={`relative flex size-20 items-center justify-center rounded-full text-primary-foreground transition-transform active:scale-95 ${
                connected ? "bg-destructive" : "bg-brand shadow-glow"
              }`}
            >
              {connected ? <PhoneOffIcon className="size-8" /> : <MicIcon className="size-8" />}
            </motion.button>
            <div className="relative text-center">
              <p className="font-medium">
                {connected ? "Listening… speak naturally" : "Tap to start talking"}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {connected
                  ? 'Try: "Create a hard physics exam on electromagnetism for S4, 25 multiple choice questions, 60 minutes"'
                  : "Microphone access is required. The assistant confirms each detail."}
              </p>
            </div>
          </div>
          <CardContent className="flex max-h-64 flex-col gap-2 overflow-y-auto p-4">
            {transcript.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                The conversation transcript appears here.
              </p>
            ) : (
              transcript.map((line, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {line}
                </p>
              ))
            )}
          </CardContent>
        </Card>

        {/* Draft spec panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SparklesIcon className="size-4" />
              Draft exam spec
            </CardTitle>
            <CardDescription>Updates live as you talk.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2.5 text-sm">
              <SpecRow label="Subject" value={spec.subject ? SUBJECT_LABELS[spec.subject] : null} />
              <SpecRow
                label="Class"
                value={
                  spec.level
                    ? `${spec.level === "primary" ? "Primary" : `Senior ${spec.classLevel ?? "?"}${spec.secondarySubLevel === "a_level" ? " (A level)" : spec.level === "secondary" ? " (O level)" : ""}`}`
                    : null
                }
              />
              {spec.subject === "history" && (
                <SpecRow
                  label="History branch"
                  value={
                    spec.subsidiary === "african_history"
                      ? "African History"
                      : spec.subsidiary === "european_history"
                        ? "European History"
                        : null
                  }
                />
              )}
              <SpecRow label="Topic" value={spec.topic ?? null} />
              <SpecRow
                label="Difficulty"
                value={spec.difficulty ? DIFFICULTY_LABELS[spec.difficulty] : null}
              />
              <SpecRow
                label="Duration"
                value={spec.durationMinutes ? `${spec.durationMinutes} min` : null}
              />
              <SpecRow label="Questions" value={spec.questionCount ? String(spec.questionCount) : null} />
              <div className="flex items-start justify-between gap-4">
                <dt className="text-muted-foreground">Question types</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {spec.questionTypes?.length ? (
                    spec.questionTypes.map((t) => (
                      <Badge key={t} variant="secondary">
                        {QUESTION_TYPE_LABELS[t]}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            </dl>

            {billed !== null && (
              <p className="text-muted-foreground text-xs">
                Last session: {billed.toFixed(1)} min · $
                {(billed * 0.08).toFixed(2)} charged to your wallet.
              </p>
            )}

            <Button
              className="shadow-glow w-full"
              disabled={!specReady}
              onClick={() => {
                const params = new URLSearchParams({
                  subject: spec.subject!,
                  level: spec.level!,
                  sublevel: spec.level === "secondary" ? (spec.secondarySubLevel ?? "o_level") : "",
                  subsidiary: spec.subject === "history" ? (spec.subsidiary ?? "african_history") : "",
                  classLevel: String(spec.classLevel ?? (spec.secondarySubLevel === "a_level" ? 5 : 2)),
                  topic: spec.topic!,
                  difficulty: spec.difficulty ?? "medium",
                  duration: String(spec.durationMinutes ?? 45),
                  count: String(spec.questionCount!),
                  types: (spec.questionTypes ?? ["multiple_choice", "short_answer"]).join(","),
                });
                router.push(`/admin/generate?${params.toString()}`);
              }}
            >
              {specReady ? (
                <>
                  <CheckCircle2Icon data-icon="inline-start" />
                  Continue to generator
                </>
              ) : (
                <>
                  <Loader2Icon data-icon="inline-start" />
                  Waiting for details…
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <AudioLinesIcon className="size-3.5" />
        Powered by the Gemini Live API with tool calling.
      </p>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "font-medium" : "text-muted-foreground"}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
