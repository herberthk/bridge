"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangleIcon,
  BatteryChargingIcon,
  CameraIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Clock3Icon,
  EyeIcon,
  FileCheckIcon,
  GlobeIcon,
  LightbulbIcon,
  Loader2Icon,
  MicIcon,
  MonitorIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Volume2Icon,
  WifiIcon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ExamSessionPolicy } from "@/lib/schemas/attempt";

// ── Step definitions ──────────────────────────────────────────

type StepId = "welcome" | "rules" | "environment" | "permissions" | "confirm";

interface StepDef {
  id: StepId;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  description: string;
}

const STEPS: readonly StepDef[] = [
  {
    id: "welcome",
    label: "Welcome",
    shortLabel: "01",
    icon: SparklesIcon,
    description: "Overview",
  },
  {
    id: "rules",
    label: "Exam rules",
    shortLabel: "02",
    icon: ShieldCheckIcon,
    description: "Conduct",
  },
  {
    id: "environment",
    label: "Environment",
    shortLabel: "03",
    icon: GlobeIcon,
    description: "Setup check",
  },
  {
    id: "permissions",
    label: "Permissions",
    shortLabel: "04",
    icon: CameraIcon,
    description: "Camera & screen",
  },
  {
    id: "confirm",
    label: "Confirm",
    shortLabel: "05",
    icon: FileCheckIcon,
    description: "Ready to start",
  },
] as const;

// ── Rules checklist (strict management) ───────────────────────

const RULES = [
  {
    id: "fullscreen",
    icon: MonitorIcon,
    title: "Stay in fullscreen",
    detail: "Tab switching, window blur or exiting fullscreen counts as a violation.",
  },
  {
    id: "entireScreen",
    icon: MonitorIcon,
    title: "Entire screen — not Tab/Window",
    detail: "Screen share must be your ENTIRE SCREEN. Tab or Window sharing is auto-rejected and you cannot start.",
  },
  {
    id: "face",
    icon: EyeIcon,
    title: "Face visible at all times",
    detail: "Keep your face centered, well-lit and alone in frame. No other people.",
  },
  {
    id: "audio",
    icon: MicIcon,
    title: "Audio monitored",
    detail: "No talking, whispers or background voices. Only you in a quiet room.",
  },
  {
    id: "nocopy",
    icon: AlertTriangleIcon,
    title: "No copy / paste / right-click",
    detail: "Blocked and flagged automatically. DevTools shortcuts are also detected.",
  },
  {
    id: "warnings",
    icon: ZapIcon,
    title: "Two-warning policy",
    detail: "2 warnings → auto-submit and lock for teacher review. No exceptions.",
  },
  {
    id: "time",
    icon: Clock3Icon,
    title: "Timer is strict",
    detail: "No pausing. When time hits 0 your answers submit automatically.",
  },
] as const;

const ENV_ITEMS = [
  { id: "internet", icon: WifiIcon, title: "Stable internet", hint: "Exam cannot be paused if you disconnect." , manual: false },
  { id: "quiet", icon: Volume2Icon, title: "Quiet, solo workspace", hint: "No other people or devices in view." , manual: true },
  { id: "light", icon: LightbulbIcon, title: "Well-lit face", hint: "Face the light, avoid backlight or darkness." , manual: true },
  { id: "power", icon: BatteryChargingIcon, title: "Power & DND", hint: "Charger plugged in, notifications silenced." , manual: true },
] as const;

// ── Props ─────────────────────────────────────────────────────

export interface ExamOnboardingProps {
  examTitle: string;
  durationMinutes: number;
  questionCount: number;
  permissionError: string | null;
  permissionsGranted: boolean;
  cameraStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  onGrantPermissions: () => Promise<void> | void;
  onStart: () => void;
  onExit?: () => void;
  starting: boolean;
  error: string | null;
  policy?: ExamSessionPolicy;
}

// ── Hook: mic level (premium live feedback, AnalyserNode) ───

function useMicLevel(stream: MediaStream | null | undefined, active: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active || !stream) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLevel(0);
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let src: MediaStreamAudioSourceNode | null = null;
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i]!;
        const avg = sum / data.length / 255;
        // smooth + gate quiet noise floor
        setLevel((prev) => prev * 0.6 + avg * 0.4);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // AudioContext blocked — degrade gracefully
    }
    return () => {
      cancelAnimationFrame(raf);
      try {
        src?.disconnect();
        analyser?.disconnect();
      } catch {}
      void ctx?.close().catch(() => undefined);
    };
  }, [stream, active]);
  return level;
}

// ── Hook: internet liveness (best-effort) ────────────────────

function useInternetCheck() {
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [checking, setChecking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const ping = useCallback(async () => {
    setChecking(true);
    const t0 = performance.now();
    try {
      // Lightweight HEAD — falls back to same-origin fetch if blocked.
      // Use cache bust to avoid SW cache.
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      await fetch(`/api/health?t=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: ctrl.signal }).catch(() =>
        fetch(`/favicon.ico?t=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: ctrl.signal }).catch(() => {
          throw new Error("offline");
        }),
      );
      clearTimeout(to);
      setLatencyMs(Math.round(performance.now() - t0));
      setOnline(true);
    } catch {
      // navigator.onLine is the ground truth if fetch fails
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : false);
      setLatencyMs(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial liveness ping
    void ping();
    const id = window.setInterval(() => void ping(), 15_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(id);
    };
  }, [ping]);

  return { online, checking, latencyMs, ping };
}

// ── Sub-component: premium stepper ────────────────────────────

function Stepper({ step, onJump, canJumpTo }: { step: number; onJump: (i: number) => void; canJumpTo: (i: number) => boolean }) {
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Onboarding steps">
      {STEPS.map((s, i) => {
        const active = i === step;
        const done = i < step;
        const reachable = canJumpTo(i);
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "step" : undefined}
            disabled={!reachable}
            onClick={() => reachable && onJump(i)}
            className={`group flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-all ${
              active
                ? "border-primary bg-primary text-primary-foreground shadow-glow"
                : done
                  ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                  : reachable
                    ? "border-border bg-card hover:bg-accent text-muted-foreground"
                    : "border-border/60 bg-muted/50 text-muted-foreground/60 cursor-not-allowed"
            }`}
          >
            <span
              className={`grid size-5 place-items-center rounded-full text-[10px] font-bold leading-none transition-colors ${
                active ? "bg-white text-primary" : done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2Icon className="size-3.5" /> : s.shortLabel}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
            <s.icon className={`hidden size-3.5 sm:block ${active ? "text-primary-foreground" : done ? "text-primary" : "text-muted-foreground/70"}`} />
          </button>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function ExamOnboarding({
  examTitle,
  durationMinutes,
  questionCount,
  permissionError,
  permissionsGranted,
  cameraStream,
  screenStream,
  onGrantPermissions,
  onStart,
  onExit,
  starting,
  error,
  policy,
}: ExamOnboardingProps) {
  const prefersReducedMotion = useReducedMotion();
  const effectivePolicy: ExamSessionPolicy = useMemo(
    () =>
      policy ?? {
        preventBacktrack: true,
        allowReviewBeforeSubmit: false,
        allowSkipping: true,
        requireFullscreen: true,
      },
    [policy],
  );
  // Dynamic rules reflect admin-configured policy so the acknowledgement is truthful
  type Rule = { id: string; icon: React.ElementType; title: string; detail: string };
  const displayRules: Rule[] = useMemo(() => {
    const base = [...RULES] as unknown as Rule[];
    // Inject / override navigation rule to match preventBacktrack
    const navIdx = base.findIndex((r) => r.id === "fullscreen");
    // Keep fullscreen rule but tweak text when fullscreen not required
    if (!effectivePolicy.requireFullscreen && navIdx !== -1) {
      const cur = base[navIdx]!;
      base[navIdx] = {
        ...cur,
        title: "Fullscreen recommended",
        detail: "Fullscreen is encouraged but not enforced for this exam. Tab switching still counts as a violation.",
      };
    }
    // Add explicit linear-navigation rule (already covered by preventBacktrack, but surface clearly)
    const extra: Rule[] = [];
    if (effectivePolicy.preventBacktrack) {
      extra.push({
        id: "noBacktrack",
        icon: ChevronLeftIcon,
        title: "No going back — linear only",
        detail: "After you press Next you cannot see that question again. No Previous, no jump, no review unless enabled.",
      });
    }
    if (!effectivePolicy.allowSkipping) {
      extra.push({
        id: "noSkip",
        icon: AlertTriangleIcon,
        title: "No skipping — answer required",
        detail: "You must answer the current question before Next becomes available. Blank = cannot proceed.",
      });
    } else {
      extra.push({
        id: "skipAllowed",
        icon: CheckCircle2Icon,
        title: "Skipping allowed",
        detail: "You can press Next without answering — skipped questions score zero and you still cannot go back.",
      });
    }
    if (!effectivePolicy.allowReviewBeforeSubmit) {
      extra.push({
        id: "noReview",
        icon: EyeIcon,
        title: "No review before submit",
        detail: "There is no review screen — the last question goes straight to final submit. Be sure before you advance.",
      });
    }
    return [...base, ...extra];
  }, [effectivePolicy]);
  const STORAGE_KEY = "bridge:onboarding-step";
  const [step, setStep] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const n = Number(saved);
        if (Number.isFinite(n) && n >= 0 && n < STEPS.length) return n;
      }
    } catch {}
    return 0;
  });
  const [dir, setDir] = useState(1);
  const [rulesAck, setRulesAck] = useState<ReadonlySet<string>>(() => new Set());
  const [envAck, setEnvAck] = useState<ReadonlySet<string>>(() => new Set());
  const [consent, setConsent] = useState(false);
  const [grantBusy, setGrantBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const net = useInternetCheck();
  const micLevel = useMicLevel(cameraStream, step === 3 && !!cameraStream);

  // Persist step in sessionStorage (resume after accidental refresh).
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(step));
    } catch {}
  }, [step]);

  // Camera preview — lazy mount only when permissions step is visible
  // or stream becomes available (memoized, transform-only animation)
  useEffect(() => {
    if (!videoRef.current || !cameraStream) return;
    const v = videoRef.current;
    v.srcObject = cameraStream;
    void v.play().catch(() => undefined);
    return () => {
      // Do not stop tracks here — parent owns lifecycle.
      v.srcObject = null;
    };
  }, [cameraStream, step]);

  // Derived gates for strict exam flow
  const rulesDone = rulesAck.size === displayRules.length;
  const envManualIds = ENV_ITEMS.filter((e) => e.manual).map((e) => e.id);
  const envDone = envManualIds.every((id) => envAck.has(id)) && net.online;
  const permissionsDone = permissionsGranted && !!cameraStream && !!screenStream;
  const confirmDone = consent && permissionsDone && rulesDone && envDone;

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return true;
      case 1:
        return rulesDone;
      case 2:
        return envDone;
      case 3:
        return permissionsDone;
      case 4:
        return confirmDone;
      default:
        return false;
    }
  }, [step, rulesDone, envDone, permissionsDone, confirmDone]);

  const canJumpTo = useCallback(
    (target: number) => {
      if (target <= step) return true;
      // Allow jump only if all intermediate gates pass
      if (target === 1) return true;
      if (target === 2) return rulesDone;
      if (target === 3) return rulesDone && envDone;
      if (target === 4) return rulesDone && envDone && permissionsDone;
      return false;
    },
    [step, rulesDone, envDone, permissionsDone],
  );

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= STEPS.length) return;
      if (next > step && !canProceed) return;
      if (!canJumpTo(next) && next > step) return;
      setDir(next > step ? 1 : -1);
      setStep(next);
    },
    [step, canProceed, canJumpTo],
  );

  const handleGrant = useCallback(async () => {
    setGrantBusy(true);
    try {
      await onGrantPermissions();
    } finally {
      setGrantBusy(false);
    }
  }, [onGrantPermissions]);

  // Keyboard: arrows + enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && canProceed && step < STEPS.length - 1) {
        e.preventDefault();
        go(step + 1);
      }
      if (e.key === "ArrowLeft" && step > 0) {
        e.preventDefault();
        go(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, canProceed, go]);

  const progressPct = ((step + 1) / STEPS.length) * 100;

  const slide = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : {
        initial: { opacity: 0, x: dir * 18, filter: "blur(4px)" },
        animate: { opacity: 1, x: 0, filter: "blur(0px)" },
        exit: { opacity: 0, x: dir * -18, filter: "blur(4px)" },
        transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <div className="bg-mesh bg-noise flex min-h-dvh flex-col items-center justify-start overflow-y-auto px-4 py-6 sm:justify-center sm:py-10">
      {/* Premium card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="shadow-lifted gradient-border flex w-full max-w-[720px] flex-col overflow-hidden rounded-[20px] bg-card will-change-transform"
        style={{ boxShadow: "var(--shadow-lifted), 0 20px 60px -20px oklch(0.52 0.22 271 / 0.18)" }}
      >
        {/* ── Brand header ── */}
        <div className="bg-brand relative overflow-hidden px-6 py-6 text-primary-foreground sm:px-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "radial-gradient(32rem 16rem at 14% 0%, rgba(255,255,255,.9), transparent 60%), radial-gradient(28rem 18rem at 90% 10%, rgba(255,255,255,.5), transparent 60%)",
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/15" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 text-xs font-medium tracking-wide opacity-85">
                <SparklesIcon className="size-3.5" /> Secure exam session
              </p>
              <h1 className="mt-1 max-w-[38ch] text-pretty text-xl font-semibold tracking-tight sm:text-2xl">{examTitle}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/14 px-3 py-1 text-xs font-medium backdrop-blur">
                  <Clock3Icon className="size-3.5 opacity-90" /> {durationMinutes} minutes
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/14 px-3 py-1 text-xs font-medium backdrop-blur">
                  <FileCheckIcon className="size-3.5 opacity-90" /> {questionCount} questions
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/14 px-3 py-1 text-xs font-medium backdrop-blur">
                  <EyeIcon className="size-3.5 opacity-90" /> AI proctored
                </span>
              </div>
            </div>
            <div className="hidden shrink-0 items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs font-medium backdrop-blur sm:inline-flex">
              <span className="size-2 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_10px_theme(colors.emerald.300)]" />
              Step {step + 1} of {STEPS.length}
            </div>
          </div>

          {/* Stepper + progress */}
          <div className="relative mt-5 flex flex-col gap-3">
            <Stepper step={step} onJump={go} canJumpTo={canJumpTo} />
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <motion.div
                className="h-full rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.6)]"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </div>

        {/* ── Step body (AnimatePresence) ── */}
        <div className="flex min-h-[380px] flex-col gap-0 bg-card">
          <div className="flex-1 px-5 py-6 sm:px-7">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={STEPS[step].id}
                custom={dir}
                initial={slide.initial}
                animate={slide.animate}
                exit={slide.exit}
                transition={slide.transition}
                className="will-change-transform"
              >
                {/* Step 1: Welcome */}
                {step === 0 && (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-start gap-3">
                      <span className="shadow-glow grid size-10 place-items-center rounded-xl bg-brand text-primary-foreground">
                        <ShieldCheckIcon className="size-5" />
                      </span>
                      <div>
                        <h2 className="text-base font-semibold tracking-tight">You&apos;re about to start a proctored exam</h2>
                        <p className="text-muted-foreground mt-1 max-w-prose text-sm leading-relaxed">
                          Read each step carefully. The timer starts the moment you press <em className="text-foreground font-medium not-italic">Start exam</em> — there is no pausing, no retakes from this screen.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { k: "Time", v: `${durationMinutes} min`, sub: "Strict timer", icon: Clock3Icon },
                        { k: "Questions", v: `${questionCount}`, sub: "Auto-submits at 0", icon: FileCheckIcon },
                        { k: "Attempts", v: "One sitting", sub: "No re-entry", icon: ZapIcon },
                      ].map((s) => (
                        <div key={s.k} className="rounded-xl border bg-muted/30 p-3 text-center shadow-card sm:p-4">
                          <s.icon className="text-primary mx-auto size-4" />
                          <p className="mt-1.5 text-sm font-semibold">{s.v}</p>
                          <p className="text-muted-foreground text-xs">{s.k} · {s.sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* Policy summary — so user knows what they are agreeing to */}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={effectivePolicy.preventBacktrack ? "destructive" : "secondary"} className="gap-1">
                        {effectivePolicy.preventBacktrack ? "No backtrack" : "Backtracking allowed"}
                      </Badge>
                      <Badge variant={effectivePolicy.allowSkipping ? "secondary" : "outline"} className="gap-1">
                        {effectivePolicy.allowSkipping ? "Skipping allowed" : "No skipping"}
                      </Badge>
                      <Badge variant={effectivePolicy.requireFullscreen ? "default" : "outline"} className="gap-1">
                        {effectivePolicy.requireFullscreen ? "Fullscreen locked" : "Fullscreen optional"}
                      </Badge>
                      <Badge variant={effectivePolicy.allowReviewBeforeSubmit ? "secondary" : "outline"} className="gap-1">
                        {effectivePolicy.allowReviewBeforeSubmit ? "Review before submit" : "No review — direct submit"}
                      </Badge>
                    </div>

                    <Alert className="border-amber-200 bg-amber-50/70 dark:border-amber-900/30 dark:bg-amber-950/20">
                      <AlertTriangleIcon data-icon="inline-start" className="text-amber-600" />
                      <AlertTitle className="text-amber-900 dark:text-amber-100">Strict anti-cheating is active</AlertTitle>
                      <AlertDescription className="text-amber-800/90 dark:text-amber-200/90">
                        Tab switch, copy/paste, context menu, DevTools and leaving fullscreen are detected. You get <strong>two warnings</strong> — the third violation auto-submits and flags the attempt for teacher review.
                        {effectivePolicy.preventBacktrack && (
                          <> No going back — after <strong>Next</strong> you cannot see that question again.</>
                        )}
                      </AlertDescription>
                    </Alert>

                    <ul className="text-muted-foreground grid gap-1.5 text-xs leading-relaxed">
                      <li className="flex gap-2"><CheckCircle2Icon className="text-success mt-0.5 size-3.5 shrink-0" /> Keep your face centered and alone in frame.</li>
                      <li className="flex gap-2"><CheckCircle2Icon className="text-success mt-0.5 size-3.5 shrink-0" /> Use a stable, well-lit, quiet room with power connected.</li>
                      <li className="flex gap-2"><CheckCircle2Icon className="text-success mt-0.5 size-3.5 shrink-0" /> Camera + mic + <strong className="text-foreground">ENTIRE SCREEN</strong> sharing (not Tab/Window) stay on for the entire exam.</li>
                      {effectivePolicy.requireFullscreen && (
                        <li className="flex gap-2"><CheckCircle2Icon className="text-success mt-0.5 size-3.5 shrink-0" /> Fullscreen locks on start — you cannot exit until you submit (admin can disable).</li>
                      )}
                      {effectivePolicy.preventBacktrack && (
                        <li className="flex gap-2"><CheckCircle2Icon className="text-success mt-0.5 size-3.5 shrink-0" /> Linear only — no Previous or question jump. Skipped questions still cannot be revisited.</li>
                      )}
                    </ul>

                    {error && (
                      <Alert variant="destructive">
                        <AlertTriangleIcon data-icon="inline-start" />
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {/* Step 2: Rules */}
                {step === 1 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Rules &amp; conduct</h2>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Tap each rule to acknowledge. All must be checked to continue — this is your formal agreement.
                      </p>
                    </div>

                    <div className="grid gap-2.5">
                      {displayRules.map((r) => {
                        const done = rulesAck.has(r.id);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() =>
                              setRulesAck((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              })
                            }
                            className={`group flex w-full items-start gap-3 rounded-xl border p-3.5 text-left shadow-card transition-all hover:shadow-lifted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              done ? "border-primary/30 bg-accent/50" : "bg-card hover:bg-accent/30"
                            }`}
                          >
                            <span
                              className={`mt-0.5 grid size-6 place-items-center rounded-full border transition-colors ${
                                done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground group-hover:border-primary/30"
                              }`}
                            >
                              {done ? <CheckCircle2Icon className="size-4" /> : <CircleIcon className="size-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-sm font-medium leading-none">
                                <r.icon className={`size-3.5 ${done ? "text-primary" : "text-muted-foreground"}`} />
                                {r.title}
                              </span>
                              <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">{r.detail}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">
                        {rulesAck.size}/{displayRules.length} acknowledged
                      </span>
                      <span className={`font-medium ${rulesDone ? "text-success" : "text-amber-600"}`}>
                        {rulesDone ? "All acknowledged ✓" : `${displayRules.length - rulesAck.size} remaining`}
                      </span>
                    </div>
                  </div>
                )}

                {/* Step 3: Environment */}
                {step === 2 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Environment check</h2>
                      <p className="text-muted-foreground mt-1 text-sm">Fix issues now — you cannot adjust once the timer starts.</p>
                    </div>

                    {/* Internet live card */}
                    <div className={`flex items-center gap-3 rounded-xl border p-3.5 shadow-card transition-colors ${net.online ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
                      <span className={`grid size-10 place-items-center rounded-xl ${net.online ? "bg-success text-success-foreground" : "bg-destructive text-white"}`}>
                        <WifiIcon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {net.online ? "Internet connected" : "No internet — reconnect to continue"}
                          {net.latencyMs !== null && net.online && (
                            <Badge variant={net.latencyMs < 300 ? "secondary" : "outline"} className="font-mono text-[11px]">
                              {net.latencyMs} ms
                            </Badge>
                          )}
                          {net.checking && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {net.online ? "The exam cannot be paused. Stay on stable Wi-Fi / data." : "Check Wi-Fi, mobile data or your router."}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void net.ping()} disabled={net.checking}>
                        {net.checking ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
                        Retry
                      </Button>
                    </div>

                    <div className="grid gap-2.5">
                      {ENV_ITEMS.filter((e) => e.manual).map((item) => {
                        const done = envAck.has(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() =>
                              setEnvAck((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              })
                            }
                            className={`flex items-center gap-3 rounded-xl border p-3.5 text-left shadow-card transition-all hover:shadow-lifted ${
                              done ? "border-primary/30 bg-accent/50" : "hover:bg-accent/30"
                            }`}
                          >
                            {done ? <CheckCircle2Icon className="text-primary size-5 shrink-0" /> : <CircleIcon className="text-muted-foreground size-5 shrink-0" />}
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-medium">
                                <item.icon className="size-3.5" /> {item.title}
                              </span>
                              <span className="text-muted-foreground text-xs">{item.hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <Alert>
                      <LightbulbIcon data-icon="inline-start" />
                      <AlertTitle>Tips for a clean proctoring session</AlertTitle>
                      <AlertDescription>Close extra tabs/apps, put phone away, tell people nearby not to interrupt. A failed AI snapshot can trigger a warning.</AlertDescription>
                    </Alert>
                  </div>
                )}

                {/* Step 4: Permissions & live preview */}
                {step === 3 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Camera, microphone &amp; entire screen</h2>
                      <p className="text-muted-foreground mt-1 text-sm">
                        We record camera + <strong className="text-foreground">entire screen</strong> for the whole exam. <span className="text-destructive font-medium">Tab or Window sharing will be auto-rejected.</span> Allow both to continue and preview below.
                      </p>
                    </div>

                    <Alert className="border-primary/20 bg-primary/5 py-2.5">
                      <MonitorIcon data-icon="inline-start" className="text-primary size-4" />
                      <AlertTitle className="text-sm">How to pick the right option</AlertTitle>
                      <AlertDescription className="text-xs leading-relaxed">
                        In the browser picker choose the <strong>“Entire screen”</strong> tab → select your screen → click <strong>Share</strong>. Do not choose “Window” or “Chrome Tab” — those are blocked.
                      </AlertDescription>
                    </Alert>

                    {/* Preview grid — lazy mount */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* Camera */}
                      <div className="group relative overflow-hidden rounded-xl border bg-muted shadow-card">
                        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-2 text-xs font-medium text-white">
                          <span className="inline-flex items-center gap-1.5">
                            <CameraIcon className="size-3.5" /> Camera &amp; mic
                          </span>
                          {permissionsGranted && cameraStream ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">● LIVE</span>
                          ) : (
                            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] backdrop-blur">OFF</span>
                          )}
                        </div>
                        <div className="aspect-[4/3] bg-black/90">
                          {permissionsGranted && cameraStream ? (
                            <video ref={videoRef} muted playsInline autoPlay className="size-full object-cover" />
                          ) : (
                            <div className="grid size-full place-items-center p-6 text-center">
                              <div className="flex flex-col items-center gap-2 text-white/70">
                                <span className="grid size-12 place-items-center rounded-2xl bg-white/10">
                                  <CameraIcon className="size-6" />
                                </span>
                                <p className="text-xs">Camera preview appears here</p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 border-t bg-card px-3 py-2 text-xs">
                          <MicIcon className={`size-3.5 ${permissionsGranted && cameraStream ? "text-success" : "text-muted-foreground"}`} />
                          <span className={permissionsGranted && cameraStream ? "text-success font-medium" : "text-muted-foreground"}>
                            {permissionsGranted && cameraStream ? "Microphone enabled" : "Microphone off"}
                          </span>
                          {permissionsGranted && cameraStream && (
                            <span className="ml-auto flex items-center gap-0.5" aria-hidden>
                              {Array.from({ length: 5 }).map((_, i) => {
                                const active = micLevel > (i + 1) * 0.14;
                                return (
                                  <span
                                    key={i}
                                    className={`block w-1 rounded-full transition-all duration-100 ${active ? "bg-success" : "bg-muted"}`}
                                    style={{ height: `${6 + i * 3}px`, opacity: active ? 1 : 0.5 }}
                                  />
                                );
                              })}
                              <span className="sr-only">Mic level {Math.round(micLevel * 100)}%</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Screen */}
                      <div className="group relative overflow-hidden rounded-xl border bg-muted shadow-card">
                        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-2 text-xs font-medium text-white">
                          <span className="inline-flex items-center gap-1.5">
                            <MonitorIcon className="size-3.5" /> Screen share
                          </span>
                          {permissionsGranted && screenStream ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">● SHARING</span>
                          ) : (
                            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] backdrop-blur">NOT SHARING</span>
                          )}
                        </div>
                        <div className="aspect-[4/3] grid place-items-center bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-center">
                          {permissionsGranted && screenStream ? (
                            <div className="flex flex-col items-center gap-2 text-white">
                              <span className="grid size-12 place-items-center rounded-2xl bg-emerald-500 shadow-glow">
                                <CheckCircle2Icon className="size-7 text-white" />
                              </span>
                              <p className="text-sm font-medium">Screen sharing active</p>
                              <p className="text-xs text-white/70">Do not stop sharing during the exam</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-white/75">
                              <span className="grid size-12 place-items-center rounded-2xl bg-white/10">
                                <MonitorIcon className="size-6" />
                              </span>
                              <p className="text-xs">Screen preview is managed by your browser</p>
                            </div>
                          )}
                        </div>
                        <div className="border-t bg-card px-3 py-2 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-medium text-success"><CheckCircle2Icon className="size-3.5" /> Required: Entire screen</span>
                          <span className="text-muted-foreground"> — Window / Tab will be rejected. Pick “Entire screen” → Share.</span>
                        </div>
                      </div>
                    </div>

                    {permissionError && (
                      <Alert variant="destructive">
                        <CameraIcon data-icon="inline-start" />
                        <AlertDescription>{permissionError}</AlertDescription>
                      </Alert>
                    )}

                    <div className="rounded-xl border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                      <p className="font-medium text-foreground">Why entire screen?</p>
                      Camera + mic feed AI snapshot analysis every 30s; <strong className="text-foreground">entire-screen</strong> recording proves no outside help on any app. Tab/Window sharing is blocked because it hides other apps. Recordings are uploaded after you submit and never shared outside your school.
                    </div>

                    {/* Visual picker guide — premium, explicit */}
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                      <div className="rounded-xl border border-success/30 bg-success/10 p-2.5">
                        <MonitorIcon className="mx-auto size-5 text-success" />
                        <p className="mt-1 font-semibold text-success">Entire screen ✓</p>
                        <p className="text-muted-foreground">Allowed</p>
                      </div>
                      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-2.5 opacity-80">
                        <div className="mx-auto grid size-5 place-items-center rounded bg-muted text-muted-foreground">▭</div>
                        <p className="mt-1 font-semibold text-destructive">Window ✗</p>
                        <p className="text-muted-foreground">Blocked</p>
                      </div>
                      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-2.5 opacity-80">
                        <div className="mx-auto grid size-5 place-items-center rounded bg-muted text-muted-foreground">◧</div>
                        <p className="mt-1 font-semibold text-destructive">Chrome Tab ✗</p>
                        <p className="text-muted-foreground">Blocked</p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      {!permissionsGranted ? (
                        <Button className="shadow-glow h-11 flex-1 justify-center px-6" onClick={handleGrant} disabled={grantBusy}>
                          {grantBusy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CameraIcon data-icon="inline-start" />}
                          {grantBusy ? "Requesting permissions…" : "Allow camera, mic & entire screen"}
                        </Button>
                      ) : (
                        <div className="flex flex-1 items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
                          <CheckCircle2Icon className="size-5" /> Entire screen granted — you can continue
                        </div>
                      )}
                      <Button variant="outline" onClick={handleGrant} disabled={grantBusy} className="h-11">
                        Re-check
                      </Button>
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      If blocked, click the lock icon in your address bar → Site settings → Allow Camera / Microphone / Display. You must pick “Entire screen”, not Window/Tab.
                    </p>
                  </div>
                )}

                {/* Step 5: Confirm */}
                {step === 4 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Ready to start?</h2>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {effectivePolicy.allowReviewBeforeSubmit
                          ? "Review the settings and confirm — the timer and recording start immediately."
                          : "Final confirmation — there is no review screen after this. The timer and recording start immediately."}
                      </p>
                    </div>

                    <div className="rounded-xl border bg-muted/20 p-4">
                      <p className="text-sm font-medium">{examTitle}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">{durationMinutes} min</Badge>
                        <Badge variant="secondary">{questionCount} questions</Badge>
                        <Badge variant="outline" className="border-success/30 text-success">Strict mode</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <span className={`rounded-lg border px-2 py-2 ${rulesDone ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
                          Rules {rulesDone ? "✓" : "✗"}
                        </span>
                        <span className={`rounded-lg border px-2 py-2 ${envDone ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
                          Env {envDone ? "✓" : "✗"}
                        </span>
                        <span className={`rounded-lg border px-2 py-2 ${permissionsDone ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
                          Permissions {permissionsDone ? "✓" : "✗"}
                        </span>
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 shadow-card transition-colors hover:bg-accent/30 has-[input:checked]:border-primary/30 has-[input:checked]:bg-accent/50">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                        className="mt-0.5 size-4 accent-primary"
                      />
                      <span className="text-sm leading-relaxed">
                        I understand this exam is <strong>AI-proctored and recorded</strong>, I have a stable connection and quiet environment,
                        and I accept the strict rules above. I know violations auto-submit the exam.
                        {effectivePolicy.preventBacktrack && <> I know I cannot go back after pressing Next.</>}
                        {effectivePolicy.requireFullscreen && <> Fullscreen will lock on start.</>}
                        {!effectivePolicy.allowReviewBeforeSubmit && <> There is no review screen before final submit.</>}
                      </span>
                    </label>

                    {error && (
                      <Alert variant="destructive">
                        <AlertTriangleIcon data-icon="inline-start" />
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}

                    {!permissionsDone && (
                      <Alert variant="destructive">
                        <AlertTriangleIcon data-icon="inline-start" />
                        <AlertDescription>Camera/mic/screen permissions are still missing — go back to the previous step to allow them.</AlertDescription>
                      </Alert>
                    )}

                    <div className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                      By starting you agree to fullscreen + continuous <strong>entire-screen</strong> recording. You’ll be asked to enter fullscreen; staying there avoids warnings. Tab/Window sharing is not permitted.
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Footer: Back / Next / Start ── */}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-5 py-4 sm:px-7">
            {step === 0 ? (
              <Button variant="ghost" size="lg" onClick={() => onExit?.()} className="min-w-[96px]">
                <ChevronLeftIcon data-icon="inline-start" />
                Exit
              </Button>
            ) : (
              <Button variant="outline" size="lg" onClick={() => go(step - 1)} className="min-w-[96px]">
                <ChevronLeftIcon data-icon="inline-start" />
                Back
              </Button>
            )}

            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="hidden md:inline">Use ← → to navigate</span>
              <span className="hidden items-center gap-1 sm:inline-flex">
                {STEPS.map((_, i) => (
                  <span key={i} className={`block h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/40" : "w-3 bg-muted-foreground/20"}`} />
                ))}
              </span>
            </div>

            {step < STEPS.length - 1 ? (
              <Button size="lg" onClick={() => go(step + 1)} disabled={!canProceed} className="shadow-glow min-w-[108px]">
                Next
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            ) : (
              <Button size="lg" onClick={onStart} disabled={!confirmDone || starting} className="shadow-glow min-w-[164px]">
                {starting ? (
                  <>
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <ZapIcon data-icon="inline-start" />
                    I&apos;m ready — start
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Tiny policy footer outside card chrome */}
        <div className="bg-muted/30 px-6 py-3 text-center text-[11px] leading-relaxed text-muted-foreground sm:px-7">
          Recordings are encrypted and visible only to your teacher for review. Time is server-enforced — closing the tab does not pause the exam.
        </div>
      </motion.div>

      {/* Background accent orbs — premium depth, pointer-events none */}
      <div aria-hidden className="pointer-events-none fixed -z-10 inset-0 overflow-hidden">
        <div className="absolute -top-28 -left-28 size-[520px] rounded-full bg-brand opacity-[0.08] blur-[80px]" />
        <div className="absolute -bottom-32 -right-32 size-[620px] rounded-full bg-brand opacity-[0.07] blur-[90px]" />
      </div>
    </div>
  );
}
