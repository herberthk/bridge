import { describe, expect, it, vi } from "vitest";

import { stopMediaStreams } from "@/lib/exam/media-streams";

describe("proctoring stream cleanup", () => {
  it("stops camera and screen tracks when recording is disabled", () => {
    const cameraStops = [vi.fn(), vi.fn()];
    const screenStops = [vi.fn()];
    const camera = {
      getTracks: () => cameraStops.map((stop) => ({ stop })),
    } as unknown as MediaStream;
    const screen = {
      getTracks: () => screenStops.map((stop) => ({ stop })),
    } as unknown as MediaStream;

    stopMediaStreams(camera, screen);

    cameraStops.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
    expect(screenStops[0]).toHaveBeenCalledOnce();
  });
});
