"use client";

import {
  BufferTarget,
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Output,
  QUALITY_LOW,
  WebMOutputFormat,
} from "mediabunny";

/**
 * Records a MediaStream to an in-memory WebM file using mediabunny
 * (WebCodecs — encoding happens off the main thread). `stop()` finalizes
 * and returns the blob.
 */
export class StreamRecorder {
  private output: Output;
  private videoSource: MediaStreamVideoTrackSource | null = null;
  private audioSource: MediaStreamAudioTrackSource | null = null;
  private stream: MediaStream;
  private started = false;

  constructor(
    stream: MediaStream,
    opts: { videoBitrate?: number } = {},
  ) {
    this.stream = stream;
    this.output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget(),
    });

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      this.videoSource = new MediaStreamVideoTrackSource(videoTrack, {
        codec: "vp9",
        bitrate: opts.videoBitrate ?? QUALITY_LOW,
      });
      this.output.addVideoTrack(this.videoSource);
    }
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.audioSource = new MediaStreamAudioTrackSource(audioTrack, {
        codec: "opus",
        bitrate: 48_000,
      });
      this.output.addAudioTrack(this.audioSource);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.output.start();
  }

  get recording(): boolean {
    return this.started;
  }

  /** Stop capture and finalize the container. Returns the WebM blob. */
  async stop(): Promise<Blob | null> {
    if (!this.started) return null;
    this.started = false;
    this.stream.getTracks().forEach((t) => t.stop());
    try {
      await this.output.finalize();
    } catch (err) {
      console.warn("[recording] finalize failed", err);
      return null;
    }
    const buffer = (this.output.target as BufferTarget).buffer;
    if (!buffer) return null;
    return new Blob([buffer], { type: "video/webm" });
  }
}
