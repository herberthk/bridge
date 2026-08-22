/**
 * Exam clock worker — ticks every second, immune to main-thread jank and
 * (mostly) to background tab throttling. Posts the remaining time to the UI.
 */

interface InitMessage {
  type: "init";
  deadlineMs: number;
}

interface SyncMessage {
  type: "sync";
  deadlineMs: number;
}

type InMessage = InitMessage | SyncMessage | { type: "stop" };

let deadline = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (!deadline) return;
  const remaining = deadline - Date.now();
  (self as unknown as Worker).postMessage({
    type: "tick",
    remaining,
    expired: remaining <= 0,
  });
  if (remaining <= 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (msg.type === "init" || msg.type === "sync") {
    deadline = msg.deadlineMs;
    if (!timer) timer = setInterval(tick, 1000);
    tick();
  } else if (msg.type === "stop") {
    if (timer) clearInterval(timer);
    timer = null;
  }
};

export {};
