"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StreamRecorder } from "@/lib/exam/recording";
import { PROCTORING } from "@/lib/constants";
import type { ProctoringSeverity } from "@/types/firestore";

export interface ProctoringViolation {
  type: string;
  reason?: string;
}

interface ProctoringHandlers {
  onWarning: (warnings: number, violation: ProctoringViolation) => void;
  onTerminate: (violation: ProctoringViolation) => void;
}

export interface ProctoringRig {
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  snapshotVideoRef: React.RefObject<HTMLVideoElement | null>;
  permissionError: string | null;
  requestPermissions: () => Promise<boolean>;
  beginExamCapture: () => Promise<void>;
  stopEverything: () => Promise<{ cameraBlob: Blob | null; screenBlob: Blob | null }>;
  report: (type: string, severity: ProctoringSeverity, details?: Record<string, unknown>) => void;
}

/**
 * The full proctoring rig for one exam session:
 * - camera + microphone and screen capture (mediabunny recording)
 * - violation listeners (tab switch, blur, fullscreen exit, copy/paste,
 *   context menu, devtools shortcuts)
 * - periodic AI snapshot analysis (frames compressed in a web worker)
 * - two-warning policy enforcement via the server proctor endpoint
 */
export function useProctoring(
  attemptId: string | null,
  handlers: ProctoringHandlers,
): ProctoringRig {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const snapshotVideoRef = useRef<HTMLVideoElement | null>(null);
  const camRecorderRef = useRef<StreamRecorder | null>(null);
  const screenRecorderRef = useRef<StreamRecorder | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitoringRef = useRef(false);
  const lastViolationRef = useRef(0);
  const attemptIdRef = useRef(attemptId);
  const handlersRef = useRef(handlers);

  // Keep refs fresh for the long-lived listeners below.
  useEffect(() => {
    attemptIdRef.current = attemptId;
    handlersRef.current = handlers;
  });

  const report = useCallback(
    async (type: string, severity: ProctoringSeverity, details: Record<string, unknown> = {}) => {
      const id = attemptIdRef.current;
      if (!id || !monitoringRef.current) return;
      // Debounce bursts (e.g. blur + visibilitychange fire together).
      const now = Date.now();
      if (now - lastViolationRef.current < 800) return;
      lastViolationRef.current = now;

      try {
        const res = await fetch(`/api/attempts/${id}/proctor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, severity, details }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          action: "continue" | "warn" | "terminate";
          warnings: number;
        };
        if (data.action === "terminate") {
          monitoringRef.current = false;
          handlersRef.current.onTerminate({ type, ...details } as ProctoringViolation);
        } else if (data.action === "warn") {
          handlersRef.current.onWarning(data.warnings, { type, ...details } as ProctoringViolation);
        }
      } catch {
        // Offline — the server deadline still guards the session.
      }
    },
    [],
  );

  const compressSnapshot = useCallback((bitmap: ImageBitmap): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!workerRef.current) return resolve(null);
      const worker = workerRef.current;
      const timeout = setTimeout(() => resolve(null), 8000);
      worker.onmessage = (event: MessageEvent) => {
        if (event.data.type === "compressed") {
          clearTimeout(timeout);
          resolve(event.data.blob as Blob);
        }
      };
      worker.postMessage(
        { type: "compress", bitmap, maxWidth: 640, quality: 0.7 },
        [bitmap],
      );
    });
  }, []);

  const analyzeSnapshot = useCallback(async () => {
    const id = attemptIdRef.current;
    const video = snapshotVideoRef.current;
    if (!id || !video || video.readyState < 2) return;
    try {
      const bitmap = await createImageBitmap(video);
      const blob = await compressSnapshot(bitmap);
      if (!blob) return;
      const base64 = await blobToBase64(blob);
      const res = await fetch(`/api/attempts/${id}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        verdict: "ok" | "warning" | "violation";
        reason: string;
        action?: "continue" | "warn" | "terminate";
        warnings?: number;
      };
      if (data.verdict !== "ok" && data.action === "terminate") {
        monitoringRef.current = false;
        handlersRef.current.onTerminate({ type: "ai_flag", reason: data.reason });
      } else if (data.verdict !== "ok" && data.action === "warn") {
        handlersRef.current.onWarning(data.warnings ?? 1, {
          type: "ai_flag",
          reason: data.reason,
        });
      }
    } catch {
      // Snapshots are best-effort.
    }
  }, [compressSnapshot]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    setPermissionError(null);
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: true,
      });
      setCameraStream(cam);
    } catch {
      setPermissionError(
        "Camera & microphone access is required for AI proctoring. Allow access in your browser and try again.",
      );
      return false;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      screen.getVideoTracks()[0]?.addEventListener("ended", () => {
        void report("fullscreen_exit", "high", { source: "screen-share-stopped" });
      });
      setScreenStream(screen);
    } catch {
      setPermissionError(
        "Screen sharing is required for proctoring. Choose your screen/window and try again.",
      );
      setCameraStream((cam) => {
        cam?.getTracks().forEach((t) => t.stop());
        return null;
      });
      return false;
    }
    return true;
  }, [report]);

  const beginExamCapture = useCallback(async () => {
    if (!cameraStream || !screenStream) return;
    try {
      camRecorderRef.current = new StreamRecorder(cameraStream);
      screenRecorderRef.current = new StreamRecorder(screenStream, { videoBitrate: 300_000 });
      await Promise.all([
        camRecorderRef.current.start(),
        screenRecorderRef.current.start(),
      ]);
    } catch (err) {
      console.warn("[proctoring] recorders failed to start", err);
    }

    // Hidden video element feeds snapshot analysis from the camera stream.
    if (!snapshotVideoRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.style.display = "none";
      document.body.appendChild(video);
      snapshotVideoRef.current = video;
    }
    snapshotVideoRef.current.srcObject = cameraStream;
    await snapshotVideoRef.current.play().catch(() => undefined);

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../../workers/proctoring-snapshot.worker.ts", import.meta.url),
        { type: "module" },
      );
    }

    monitoringRef.current = true;
    snapshotTimerRef.current = setInterval(
      () => void analyzeSnapshot(),
      PROCTORING.snapshotIntervalMs,
    );
  }, [cameraStream, screenStream, analyzeSnapshot]);

  const stopEverything = useCallback(async () => {
    monitoringRef.current = false;
    if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
    snapshotTimerRef.current = null;

    const [cameraBlob, screenBlob] = await Promise.all([
      camRecorderRef.current?.stop() ?? null,
      screenRecorderRef.current?.stop() ?? null,
    ]);
    camRecorderRef.current = null;
    screenRecorderRef.current = null;

    workerRef.current?.terminate();
    workerRef.current = null;
    if (snapshotVideoRef.current) {
      snapshotVideoRef.current.srcObject = null;
      snapshotVideoRef.current.remove();
      snapshotVideoRef.current = null;
    }
    return { cameraBlob, screenBlob };
  }, []);

  // Violation listeners, active while monitoring.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) void report("tab_switch", "high", { at: Date.now() });
    };
    const onBlur = () => void report("window_blur", "medium", { at: Date.now() });
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && monitoringRef.current) {
        void report("fullscreen_exit", "high", { at: Date.now() });
      }
    };
    const onCopy = (e: Event) => {
      e.preventDefault();
      void report("copy_attempt", "high", { at: Date.now() });
    };
    const onPaste = (e: Event) => {
      e.preventDefault();
      void report("paste_attempt", "high", { at: Date.now() });
    };
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      void report("context_menu", "low", { at: Date.now() });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const devtools =
        e.key === "F12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key));
      if (devtools) {
        e.preventDefault();
        void report("devtools_shortcut", "high", { key: e.key });
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [report]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      void stopEverything();
    };
  }, [stopEverything]);

  return {
    cameraStream,
    screenStream,
    snapshotVideoRef,
    permissionError,
    requestPermissions,
    beginExamCapture,
    stopEverything,
    report,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
