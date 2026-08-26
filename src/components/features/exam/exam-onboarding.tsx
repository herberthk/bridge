"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  MonitorIcon,
  ShieldCheckIcon,
  WifiIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const CHECKLIST = [
  { icon: WifiIcon, label: "Stable internet", hint: "The exam cannot be paused once started." },
  { icon: CameraIcon, label: "Camera & microphone", hint: "Required for AI proctoring." },
  { icon: MonitorIcon, label: "Screen sharing", hint: "Required for monitoring against outside help." },
  { icon: ShieldCheckIcon, label: "Quiet, solo workspace", hint: "Only you should be visible and audible." },
] as const;

export function ExamOnboarding({
  examTitle,
  durationMinutes,
  questionCount,
  permissionError,
  permissionsGranted,
  onGrantPermissions,
  onStart,
  starting,
  error,
}: {
  examTitle: string;
  durationMinutes: number;
  questionCount: number;
  permissionError: string | null;
  permissionsGranted: boolean;
  onGrantPermissions: () => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
}) {
  // Track what is NOT yet acknowledged. When permissions flip to granted the
  // checklist simply stops excluding items — derived state, no setState-in-effect.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(
    () => new Set(CHECKLIST.map((c) => c.label)),
  );
  const allChecked = unchecked.size === 0;

  return (
    <div className="bg-mesh bg-noise flex min-h-dvh items-center justify-center overflow-y-auto p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="shadow-lifted w-full max-w-2xl rounded-2xl border bg-card"
      >
        <div className="bg-brand relative overflow-hidden rounded-t-2xl p-6 text-primary-foreground">
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "radial-gradient(20rem 12rem at 15% 0%, rgba(255,255,255,.5), transparent 60%)",
            }}
          />
          <p className="relative text-sm opacity-80">Exam session</p>
          <h1 className="relative mt-1 text-2xl font-semibold tracking-tight">{examTitle}</h1>
          <div className="relative mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
              {durationMinutes} minutes
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
              {questionCount} questions
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 backdrop-blur">
              AI proctored
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-6">
          <Alert>
            <AlertTriangleIcon data-icon="inline-start" />
            <AlertTitle>Read carefully before starting</AlertTitle>
            <AlertDescription>
              This exam is strictly monitored against cheating (tab switching,
              copy/paste, other people or devices in view). You get{" "}
              <strong>two warnings</strong> — after the next violation the exam
              is submitted automatically and locked for review by your teacher.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertTriangleIcon data-icon="inline-start" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2.5">
            {CHECKLIST.map((item) => {
              const done = !unchecked.has(item.label);
              return (
                <button
                  key={item.label}
                  type="button"
                  disabled={!permissionsGranted}
                  onClick={() =>
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      next.delete(item.label);
                      return next;
                    })
                  }
                  className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                    done ? "border-primary/40 bg-accent/40" : "hover:bg-accent/30"
                  }`}
                >
                  {done ? (
                    <CheckCircle2Icon className="text-primary size-5 shrink-0" />
                  ) : (
                    <CircleIcon className="text-muted-foreground size-5 shrink-0" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <item.icon className="size-3.5" />
                      {item.label}
                    </span>
                    <span className="text-muted-foreground text-xs">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {permissionError && (
            <Alert variant="destructive">
              <CameraIcon data-icon="inline-start" />
              <AlertDescription>{permissionError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {!permissionsGranted ? (
              <Button className="shadow-glow h-11 px-6" onClick={onGrantPermissions}>
                <CameraIcon data-icon="inline-start" />
                Allow camera, mic &amp; screen
              </Button>
            ) : (
              <Button
                className="shadow-glow h-11 px-6"
                disabled={!allChecked || starting}
                onClick={onStart}
              >
                {starting ? (
                  <>
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    Starting…
                  </>
                ) : (
                  "I'm ready — start the exam"
                )}
              </Button>
            )}
            <Badge variant="secondary" className="hidden sm:inline-flex sm:self-center">
              No pausing once started
            </Badge>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
