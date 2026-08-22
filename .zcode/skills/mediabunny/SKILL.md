---
name: mediabunny
description: >
  Use this skill whenever working with the Mediabunny JavaScript library for
  reading, writing, converting, or processing media files (MP4, WebM, MKV, MP3,
  WAV, OGG, FLAC, AAC, MPEG-TS, MOV) in the browser or Node.js/Bun/Deno.
  Triggers include: any mention of "mediabunny", requests to demux/mux media,
  extract video frames/thumbnails, transcode/convert video or audio, record live
  media, generate video from canvas, stream media files, read/write metadata tags,
  or extract encoded packets. Also use when the task involves the WebCodecs API
  wrapped by Mediabunny, or when migrating from mp4-muxer / webm-muxer.
source: https://mediabunny.dev/api/
---

# Mediabunny Skill

Mediabunny is a zero-dependency, pure-TypeScript media toolkit for the browser
and server-side runtimes (Node/Bun/Deno). Think of it as FFmpeg for the web. It
handles demuxing, muxing, decoding, encoding, and conversion of media files with
microsecond-accurate timing, hardware-accelerated codecs (WebCodecs API), lazy
file reading, and streaming I/O.

---

## 1. Installation

```bash
npm install mediabunny
```

Extension packages (optional, add codec support):

| Package                    | Adds                                  |
| -------------------------- | ------------------------------------- |
| `@mediabunny/mp3-encoder`  | MP3 encoding (not in WebCodecs)       |
| `@mediabunny/aac-encoder`  | AAC encoding polyfill (some browsers) |
| `@mediabunny/ac3`          | AC-3 / E-AC-3 decode + encode         |
| `@mediabunny/flac-encoder` | FLAC encoding                         |

Register extensions **before** any encoding operations:

```ts
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
registerMp3Encoder();
registerAacEncoder();
```

---

## 2. Core Concepts

### Mental model

```
INPUT FILE
  └── Input (demuxer)
        ├── InputVideoTrack  →  Sink  →  VideoSample / CanvasResult / EncodedPacket
        └── InputAudioTrack  →  Sink  →  AudioSample / AudioBuffer / EncodedPacket

OUTPUT FILE
  └── Output (muxer)
        ├── VideoSource  ←  CanvasSource / VideoSampleSource / EncodedVideoPacketSource …
        └── AudioSource  ←  AudioBufferSource / MediaStreamAudioTrackSource …

CONVERSION
  └── Conversion.init({ input, output, video?, audio?, trim?, tags? })
        └── .execute()  ←  transmux or transcode automatically
```

### Key lifecycle rules

- `Input` is lazy — zero reads happen until data is requested.
- `Output` lifecycle: `addTrack` → `setMetadataTags` → `start()` → `add(...)` on sources → `finalize()`.
- A `Conversion` must receive a _fresh_ `Output` (no tracks added yet, state `'pending'`).
- Always call `input.dispose()` (or use `using input = ...`) for `FilePathSource` inputs to close the file handle.
- Never await `output.getMimeType()` before adding media data — it deadlocks.

---

## 3. Reading Media Files

### 3.1 Create an Input

```ts
import { Input, ALL_FORMATS, BlobSource } from "mediabunny";

// Browser: read from a File / Blob
const input = new Input({
  formats: ALL_FORMATS, // supports all formats; tree-shake with e.g. [MP4, WAVE]
  source: new BlobSource(file), // file = File instance from <input type="file">
});
```

**Tree-shake formats for smaller bundles:**

```ts
import { Input, MP4, WAVE, MP3 } from 'mediabunny';
const input = new Input({ formats: [MP4, WAVE, MP3], source: ... });
```

### 3.2 File-level metadata

```ts
await input.getFormat(); // => Mp4InputFormat
await input.getMimeType(); // => 'video/mp4; codecs="avc1.42c032, mp4a.40.2"'
await input.computeDuration(); // => seconds (e.g. 120.5)
await input.getFirstTimestamp(); // => seconds (usually 0)
await input.getMetadataTags(); // => MetadataTags
```

### 3.3 Track discovery

```ts
await input.getTracks(); // => InputTrack[]
await input.getVideoTracks(); // => InputVideoTrack[]
await input.getAudioTracks(); // => InputAudioTrack[]
await input.getPrimaryVideoTrack(); // => InputVideoTrack | null
await input.getPrimaryAudioTrack(); // => InputAudioTrack | null
```

### 3.4 Track metadata

```ts
track.id; // unique ID in file
track.number; // 1-based index among same-type tracks
track.type; // 'video' | 'audio' | 'subtitle'
track.codec; // MediaCodec | null
track.languageCode; // ISO 639-2/T or 'und'
track.name; // user-defined name
track.disposition; // TrackDisposition (default, commentary, etc.)

await track.canDecode(); // boolean
await track.computeDuration(); // seconds
await track.getFirstTimestamp(); // seconds
await track.getCodecParameterString(); // e.g. 'avc1.42001f'
await track.computePacketStats(50); // { packetCount, averagePacketRate, averageBitrate }
```

**Video-only:**

```ts
videoTrack.displayWidth;
videoTrack.displayHeight; // post-rotation px
videoTrack.codedWidth;
videoTrack.codedHeight; // raw coded px
videoTrack.rotation; // 0 | 90 | 180 | 270
await videoTrack.getDecoderConfig(); // VideoDecoderConfig | null
await videoTrack.getColorSpace(); // VideoColorSpaceInit
await videoTrack.hasHighDynamicRange(); // boolean
```

**Audio-only:**

```ts
audioTrack.numberOfChannels;
audioTrack.sampleRate; // Hz
await audioTrack.getDecoderConfig(); // AudioDecoderConfig | null
```

### 3.5 Media Sinks (extracting data)

#### VideoSampleSink — decoded video frames

```ts
import { VideoSampleSink } from 'mediabunny';

const sink = new VideoSampleSink(videoTrack);

// Single frame at a timestamp
const sample = await sink.getSample(5.0); // timestamp in seconds
sample.draw(ctx, 0, 0);     // draw to CanvasRenderingContext2D
sample.timestamp;            // seconds
sample.duration;             // seconds

// All frames in a range
for await (const sample of sink.samples(10, 20)) { ... }

// All frames
for await (const sample of sink.samples()) { ... }
```

#### CanvasSink — resized video frames / thumbnails

```ts
import { CanvasSink } from 'mediabunny';

const sink = new CanvasSink(videoTrack, {
  width: 320,   // auto-computes height to preserve AR if only one is given
  height: 180,
});

const result = await sink.getCanvas(10); // timestamp in seconds
result.canvas;     // HTMLCanvasElement | OffscreenCanvas
result.timestamp;
result.duration;

// Multiple timestamps at once
for await (const r of sink.canvasesAtTimestamps([0, 5, 10, 15])) { ... }

// Five equally-spaced thumbnails:
const start = await videoTrack.getFirstTimestamp();
const end   = await videoTrack.computeDuration();
const times = [0, 0.25, 0.5, 0.75, 1.0].map(t => start + t * (end - start));
for await (const r of sink.canvasesAtTimestamps(times)) { ... }
```

#### AudioSampleSink — decoded audio chunks

```ts
import { AudioSampleSink } from 'mediabunny';
const sink = new AudioSampleSink(audioTrack);

const sample = await sink.getSample(5.0);
sample.numberOfFrames;
const audioBuffer = sample.toAudioBuffer(); // Web Audio API AudioBuffer
for await (const s of sink.samples(0, 30)) { ... }
```

#### AudioBufferSink — decoded audio as AudioBuffer (Web Audio)

```ts
import { AudioBufferSink } from "mediabunny";
const sink = new AudioBufferSink(audioTrack);

for await (const { buffer, timestamp } of sink.buffers(5, 10)) {
  const node = audioCtx.createBufferSource();
  node.buffer = buffer;
  node.connect(audioCtx.destination);
  node.start(timestamp);
}
```

#### EncodedPacketSink — raw encoded packets (no decode)

```ts
import { EncodedPacketSink } from "mediabunny";
const sink = new EncodedPacketSink(videoTrack);

const packet = await sink.getPacket(10); // nearest packet to 10s
const keyPkt = await sink.getKeyPacket(10); // nearest key frame to 10s
const next = await sink.getNextPacket(keyPkt);

packet.data; // Uint8Array
packet.type; // 'key' | 'delta'
packet.timestamp; // seconds

// Iterate all packets (decode order)
for await (const p of sink.packets()) {
  videoDecoder.decode(p.toEncodedVideoChunk());
}
await videoDecoder.flush();
```

### 3.6 Dispose inputs

```ts
input.dispose(); // Cancel pending reads, close decoders, free resources

// Or use the 'using' keyword (Explicit Resource Management)
{
  using input = new Input({ ... });
  // auto-disposed at end of block
}
```

---

## 4. Writing Media Files

### 4.1 Create an Output

```ts
import { Output, Mp4OutputFormat, BufferTarget } from "mediabunny";

const output = new Output({
  format: new Mp4OutputFormat(),
  target: new BufferTarget(), // build entire file in memory
});
```

### 4.2 Add tracks

```ts
output.addVideoTrack(videoSource);
output.addAudioTrack(audioSource);
output.addSubtitleTrack(subtitleSource);

// With optional metadata:
output.addVideoTrack(videoSource, {
  rotation: 90, // clockwise degrees
  frameRate: 30, // use exact fractions for 23.976→ { num: 24000, den: 1001 }
});
output.addAudioTrack(audioSource, {
  language: "eng", // ISO 639-2/T
  name: "Commentary",
  disposition: { commentary: true },
});
```

### 4.3 Metadata tags

```ts
output.setMetadataTags({          // must be called BEFORE output.start()
  title: 'My Video',
  artist: 'Me',
  date: new Date('2024-01-01'),
  images: [{ data: new Uint8Array([...]), mimeType: 'image/jpeg', kind: 'coverFront' }],
});
```

### 4.4 Start, add data, finalize

```ts
await output.start();

// Add data via media sources (see §5)
await videoSource.add(timestamp, duration);
await audioSource.add(audioBuffer);

await output.finalize();

const file = output.target.buffer; // ArrayBuffer (if BufferTarget)
```

### 4.5 Output state

```ts
output.state; // 'pending' | 'started' | 'finalizing' | 'finalized' | 'canceled'
await output.cancel(); // Abort and free resources
```

### 4.6 Output Targets

#### BufferTarget — entire file in memory

```ts
const output = new Output({ target: new BufferTarget(), ... });
await output.finalize();
const buf = output.target.buffer; // ArrayBuffer
```

Best for files < ~100 MB.

#### StreamTarget — streaming (disk / network)

```ts
import { StreamTarget } from 'mediabunny';

// Write to File System API
const handle = await window.showSaveFilePicker();
const writable = await handle.createWritable();
const output = new Output({
  target: new StreamTarget(writable, { chunked: true }), // chunked = batch writes
  ...
});
await output.finalize(); // auto-closes the WritableStream

// Stream over the network (must use append-only format)
const { writable, readable } = new TransformStream({
  transform: (chunk, ctrl) => ctrl.enqueue(chunk.data),
});
const output = new Output({
  target: new StreamTarget(writable),
  format: new Mp4OutputFormat({ fastStart: 'fragmented' }), // append-only
});
fetch('https://example.com/upload', { method: 'POST', body: readable, duplex: 'half' });
```

**CRITICAL:** `StreamTarget` chunks have a `position` field. You **must** write each chunk at its specified byte offset. Simply concatenating chunks produces a corrupt file unless the format is append-only.

#### FilePathTarget — server-side file write (Node/Bun/Deno)

```ts
import { FilePathTarget } from 'mediabunny';
const output = new Output({
  target: new FilePathTarget('/path/to/output.mp4'),
  ...
});
await output.finalize();
```

#### NullTarget — discard output (for format-specific callbacks)

```ts
import { NullTarget } from 'mediabunny';
const output = new Output({ target: new NullTarget(), ... });
```

---

## 5. Media Sources (adding data to Output)

### CanvasSource — encode from canvas

```ts
import { CanvasSource, QUALITY_HIGH } from "mediabunny";

const source = new CanvasSource(canvas, {
  codec: "avc", // video codec string
  bitrate: QUALITY_HIGH, // or a number in bps e.g. 1e6
  alpha: "keep", // 'discard' (default) | 'keep' (for transparent video)
});
output.addVideoTrack(source, { frameRate: 30 });
await output.start();
// Capture canvas frames:
await source.add(timestamp, duration); // seconds
```

### AudioBufferSource — encode from Web Audio API AudioBuffer

```ts
import { AudioBufferSource } from "mediabunny";

const source = new AudioBufferSource({ codec: "aac", bitrate: 128e3 });
output.addAudioTrack(source);
await output.start();
await source.add(audioBuffer1); // AudioBuffer — timestamps derived automatically
await source.add(audioBuffer2);
```

### MediaStreamVideoTrackSource / MediaStreamAudioTrackSource — live recording

```ts
import {
  MediaStreamVideoTrackSource,
  MediaStreamAudioTrackSource,
  QUALITY_MEDIUM,
} from "mediabunny";

const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true,
});

const videoSource = new MediaStreamVideoTrackSource(
  stream.getVideoTracks()[0],
  {
    codec: "vp9",
    bitrate: QUALITY_MEDIUM,
  },
);
const audioSource = new MediaStreamAudioTrackSource(
  stream.getAudioTracks()[0],
  {
    codec: "opus",
    bitrate: QUALITY_MEDIUM,
  },
);

output.addVideoTrack(videoSource);
output.addAudioTrack(audioSource);
await output.start();
// Recording proceeds automatically from the live stream...
stream.getTracks().forEach((t) => t.stop()); // stop capture
await output.finalize();
```

### VideoSampleSource / AudioSampleSource — raw decoded samples

```ts
import { VideoSampleSource } from "mediabunny";
const source = new VideoSampleSource({ codec: "avc", bitrate: QUALITY_HIGH });
output.addVideoTrack(source);
await output.start();
await source.add(videoSample);
```

### EncodedVideoPacketSource / EncodedAudioPacketSource — bypass encoding

```ts
import { EncodedVideoPacketSource } from "mediabunny";
// Pass pre-encoded packets directly (e.g. transmuxing)
const source = new EncodedVideoPacketSource(decoderConfig);
await source.add(encodedPacket);
```

### TextSubtitleSource — add subtitles

```ts
import { TextSubtitleSource } from "mediabunny";
const source = new TextSubtitleSource({ codec: "webvtt" });
output.addSubtitleTrack(source, { language: "eng" });
await output.start();
await source.add({ timestamp: 0, duration: 2, text: "Hello, world!" });
```

### Subjective quality constants

```ts
QUALITY_VERY_LOW; // lowest
QUALITY_LOW;
QUALITY_MEDIUM;
QUALITY_HIGH;
QUALITY_VERY_HIGH; // highest
```

Use these with `bitrate` when you don't want to specify an exact bps value.

---

## 6. Conversion API

The highest-level API. Handles transmux + transcode automatically, respects
backpressure, and is pipelined for maximum performance.

### 6.1 Basic conversion

```ts
import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  BufferTarget,
} from "mediabunny";

const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
const output = new Output({
  format: new Mp4OutputFormat(),
  target: new BufferTarget(),
});

const conversion = await Conversion.init({ input, output });

if (!conversion.isValid) {
  console.log("Discarded tracks:", conversion.discardedTracks);
  return;
}

conversion.onProgress = (p) => console.log(`${Math.round(p * 100)}%`);
await conversion.execute();

const result = output.target.buffer; // ArrayBuffer
```

### 6.2 Video options

```ts
const conversion = await Conversion.init({
  input,
  output,
  video: {
    // Sizing
    width: 1280, // px; height auto-computed if omitted
    height: 720,
    fit: "contain", // 'fill' | 'contain' | 'cover'

    // Rotation & crop
    rotate: 90, // 0 | 90 | 180 | 270 (on top of input rotation)
    allowRotationMetadata: false, // don't use metadata for rotation
    crop: { left: 0, top: 0, width: 1280, height: 720 },

    // Frame rate
    frameRate: 30,

    // Encoding
    codec: "avc",
    bitrate: QUALITY_LOW, // or exact bps
    alpha: "keep", // 'discard' (default) | 'keep'
    hardwareAcceleration: "prefer-hardware",
    keyFrameInterval: 2, // seconds
    forceTranscode: true,

    // Discard
    discard: false,

    // Custom processing
    process: (sample) => {
      // Return VideoSample | CanvasImageSource | array | null (null = drop frame)
      ctx.drawImage(sample.toImageBitmap(), 0, 0); // example
      ctx.drawImage(watermark, 32, 32);
      return ctx.canvas;
    },
    processedWidth: 1280,
    processedHeight: 720,
  },
});
```

### 6.3 Audio options

```ts
const conversion = await Conversion.init({
  input,
  output,
  audio: {
    codec: "opus",
    bitrate: QUALITY_MEDIUM,
    numberOfChannels: 1, // down-mix to mono
    sampleRate: 16000, // resample to 16 kHz
    forceTranscode: true,
    discard: false,
    process: (sample) => sample, // return AudioSample | array | null
    processedNumberOfChannels: 1,
    processedSampleRate: 16000,
  },
});
```

### 6.4 Track-specific options (per-track functions)

```ts
const conversion = await Conversion.init({
  input,
  output,
  video: (track) => ({
    discard: track.number > 1, // keep only first video track
    width: Math.min(track.displayWidth, 1280),
  }),
  audio: async (track) => {
    if (track.languageCode !== "eng") return { discard: true };
    return { codec: "aac", bitrate: QUALITY_HIGH };
  },
});
```

### 6.5 Trimming

```ts
const conversion = await Conversion.init({
  input,
  output,
  trim: { start: 10, end: 25 }, // seconds; output will be 15s long
});

// Negative start = add silence/freeze frame at beginning:
trim: {
  start: -2;
}
```

### 6.6 Metadata tags

```ts
// Override:
const conversion = await Conversion.init({ ..., tags: { title: 'New Title' } });

// Augment:
const conversion = await Conversion.init({
  ...,
  tags: (inputTags) => ({ ...inputTags, comment: undefined }),
});

// Strip all:
const conversion = await Conversion.init({ ..., tags: {} });
```

### 6.7 Discarded tracks

```ts
conversion.discardedTracks; // DiscardedTrack[]
// reason: 'discarded_by_user' | 'max_track_count_reached' |
//         'max_track_count_of_type_reached' | 'unknown_source_codec' |
//         'undecodable_source_codec' | 'no_encodable_target_codec'

conversion.utilizedTracks; // InputTrack[] (tracks that made it into output)
```

### 6.8 Cancel

```ts
await conversion.cancel(); // throws ConversionCanceledError in ongoing execute()
```

---

## 7. Input Sources

| Source                                      | Use case                                            |
| ------------------------------------------- | --------------------------------------------------- |
| `BlobSource(file)`                          | Browser File / Blob (reads lazily from disk)        |
| `BufferSource(arrayBuffer)`                 | Entire file already in memory                       |
| `UrlSource(url, opts?)`                     | Remote URL; intelligent prefetching, retries        |
| `FilePathSource('/path/to/file')`           | Server-side (Node/Bun/Deno); **must dispose Input** |
| `StreamSource({ getSize, read, dispose? })` | Custom random-access reader                         |
| `ReadableStreamSource(readable)`            | Append-only byte stream (e.g. MediaRecorder output) |

All sources have `source.onread = (start, end) => {}` for monitoring reads.

### UrlSource options

```ts
new UrlSource("https://example.com/video.mp4", {
  requestInit: { headers: { Authorization: "Bearer ..." } },
  maxCacheSize: 16 * 1024 * 1024, // 16 MiB
  parallelism: 4,
  getRetryDelay: (attempts) => Math.min(2 ** attempts, 16), // exponential backoff
  fetchFn: customFetch, // e.g. Expo's fetch for React Native
});
```

### ReadableStreamSource — streaming MediaRecorder output

```ts
const { writable, readable } = new TransformStream<Blob, Uint8Array>({
  async transform(chunk, ctrl) {
    ctrl.enqueue(new Uint8Array(await chunk.arrayBuffer()));
  },
});

const input = new Input({
  source: new ReadableStreamSource(readable),
  formats: ALL_FORMATS,
});
const output = new Output({
  format: new WavOutputFormat(),
  target: new BufferTarget(),
});
const conversionPromise = Conversion.init({ input, output }).then((c) =>
  c.execute(),
);

const recorder = new MediaRecorder(micStream);
const writer = writable.getWriter();
recorder.ondataavailable = (e) => writer.write(e.data);
recorder.onstop = async () => {
  await writer.close();
  await conversionPromise;
  const wavFile = output.target.buffer; // ArrayBuffer
};
recorder.start(1000); // 1s chunks
```

---

## 8. Output Formats Reference

| Class                    | File    | Notes                                                                       |
| ------------------------ | ------- | --------------------------------------------------------------------------- |
| `Mp4OutputFormat(opts?)` | `.mp4`  | Most compatible; supports `fastStart: 'in-memory' \| 'fragmented' \| false` |
| `WebMOutputFormat()`     | `.webm` | VP8/VP9/AV1/Opus/Vorbis; supports transparency                              |
| `MkvOutputFormat()`      | `.mkv`  | Broadest codec support                                                      |
| `MovOutputFormat()`      | `.mov`  | QuickTime                                                                   |
| `WavOutputFormat()`      | `.wav`  | PCM audio                                                                   |
| `OggOutputFormat()`      | `.ogg`  | Vorbis/Opus                                                                 |
| `Mp3OutputFormat()`      | `.mp3`  | Audio only                                                                  |
| `AdtsOutputFormat()`     | `.aac`  | AAC audio only                                                              |
| `FlacOutputFormat()`     | `.flac` | FLAC audio only                                                             |
| `MpegTsOutputFormat()`   | `.ts`   | MPEG Transport Stream                                                       |

**Append-only formats** (safe for `StreamTarget` concatenation):

- `Mp4OutputFormat({ fastStart: 'fragmented' })`
- `MpegTsOutputFormat()`
- `WebMOutputFormat()` (with appropriate settings)

Access format MIME type:

```ts
output.format.mimeType; // => 'video/mp4'
await output.getMimeType(); // => 'video/mp4; codecs="avc1.42c032, mp4a.40.2"'
// WARNING: getMimeType() can deadlock if awaited before adding media data
```

---

## 9. Codec Support

### Video codecs

| String   | Name         |
| -------- | ------------ |
| `'avc'`  | H.264 / AVC  |
| `'hevc'` | H.265 / HEVC |
| `'vp8'`  | VP8          |
| `'vp9'`  | VP9          |
| `'av1'`  | AV1          |

### Audio codecs (selection)

| String                         | Notes                                            |
| ------------------------------ | ------------------------------------------------ |
| `'aac'`                        | Needs `@mediabunny/aac-encoder` on some browsers |
| `'opus'`                       | Best for WebM/Ogg                                |
| `'mp3'`                        | Needs `@mediabunny/mp3-encoder`                  |
| `'vorbis'`                     | WebM/Ogg                                         |
| `'flac'`                       | Needs `@mediabunny/flac-encoder`                 |
| `'ac3'` / `'eac3'`             | Needs `@mediabunny/ac3`                          |
| `'pcm-s16'`, `'pcm-f32'`, etc. | Built-in, always supported                       |

### Check encodability before using

```ts
import {
  canEncode,
  canEncodeVideo,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from "mediabunny";

await canEncode("avc"); // boolean — uses 1280×720 @ 1Mbps as test
await canEncodeVideo("hevc", { width: 3840, height: 2160, bitrate: 4e7 }); // boolean
await canEncodeAudio("aac", {
  numberOfChannels: 2,
  sampleRate: 44100,
  bitrate: 192e3,
});

// Find the best encodable codec for a given container:
const format = new Mp4OutputFormat();
const bestVideo = await getFirstEncodableVideoCodec(
  format.getSupportedVideoCodecs(),
);
const bestAudio = await getFirstEncodableAudioCodec(
  format.getSupportedAudioCodecs(),
);
```

---

## 10. Metadata Tags

```ts
// Read
const tags = await input.getMetadataTags();
tags.title; // string | undefined
tags.artist;
tags.album;
tags.date; // Date | undefined
tags.images; // AttachedImage[]
tags.images[0].data; // Uint8Array
tags.raw; // Record<string, string | string[]> — raw/custom tags
tags.raw["TBPM"]; // BPM (custom ID3/etc. tag)

// Write
output.setMetadataTags({
  title: "My Title",
  artist: "Artist Name",
  date: new Date("2025-01-01"),
  images: [
    {
      data: uint8ArrayOfJpeg,
      mimeType: "image/jpeg",
      kind: "coverFront", // or 'coverBack', 'icon', etc.
    },
  ],
});
```

---

## 11. Custom Encoders & Decoders

Use when the browser doesn't support a required codec natively, or in Node.js
where WebCodecs may not be available.

### Custom encoder

```ts
import { CustomAudioEncoder, registerEncoder, EncodedPacket } from "mediabunny";

class MyMp3Encoder extends CustomAudioEncoder {
  static supports(codec, config) {
    return codec === "mp3"; // MUST return true only when this encoder can handle it
  }

  async init() {
    /* setup */
  }

  async encode(sample) {
    const packets = myEncode(sample);
    for (const pkt of packets) {
      this.onPacket(pkt); // MUST call onPacket for each encoded packet (decode order)
    }
  }

  async flush() {
    /* finish pending frames; reset state */
  }
  async close() {
    /* release resources */
  }
}

registerEncoder(MyMp3Encoder);
```

### Custom decoder

```ts
import { CustomVideoDecoder, registerDecoder } from "mediabunny";

class MyHevcDecoder extends CustomVideoDecoder {
  static supports(codec, config) {
    return codec === "hevc";
  }

  async init() {}
  async decode(packet) {
    const sample = myDecode(packet);
    this.onSample(sample); // MUST emit samples sorted by timestamp (presentation order)
  }
  async flush() {
    /* emit remaining; reset */
  }
  async close() {}
}

registerDecoder(MyHevcDecoder);
```

---

## 12. Common Patterns & Recipes

### Extract audio from video → WAV

```ts
const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
const output = new Output({
  format: new WavOutputFormat(),
  target: new BufferTarget(),
});

const conversion = await Conversion.init({
  input,
  output,
  audio: { sampleRate: 16000, numberOfChannels: 1 }, // mono 16 kHz
  video: { discard: true },
});
await conversion.execute();
const wav = output.target.buffer;
```

### Generate video from canvas frames (in-browser)

```ts
const output = new Output({
  format: new Mp4OutputFormat(),
  target: new BufferTarget(),
});
const canvas = new OffscreenCanvas(1280, 720);
const ctx = canvas.getContext("2d");

const videoSource = new CanvasSource(canvas, {
  codec: "avc",
  bitrate: QUALITY_HIGH,
});
output.addVideoTrack(videoSource, { frameRate: 30 });
await output.start();

for (let i = 0; i < 300; i++) {
  // 10 seconds at 30fps
  ctx.fillStyle = `hsl(${i * 1.2}, 70%, 50%)`;
  ctx.fillRect(0, 0, 1280, 720);
  await videoSource.add(i / 30, 1 / 30);
}
await output.finalize();
const mp4 = output.target.buffer;
```

### Record live webcam + mic → WebM

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true,
});
const output = new Output({
  format: new WebMOutputFormat(),
  target: new BufferTarget(),
});

output.addVideoTrack(
  new MediaStreamVideoTrackSource(stream.getVideoTracks()[0], {
    codec: "vp9",
    bitrate: QUALITY_MEDIUM,
  }),
);
output.addAudioTrack(
  new MediaStreamAudioTrackSource(stream.getAudioTracks()[0], {
    codec: "opus",
    bitrate: QUALITY_MEDIUM,
  }),
);
await output.start();

await new Promise((resolve) => setTimeout(resolve, 10_000)); // record 10s

stream.getTracks().forEach((t) => t.stop());
await output.finalize();
const webm = output.target.buffer;
```

### Compress video (reduce resolution + bitrate + trim)

```ts
const conversion = await Conversion.init({
  input,
  output,
  video: (track) => ({
    width: 854,
    height: 480,
    fit: "contain",
    bitrate: QUALITY_LOW,
    discard: track.number > 1,
  }),
  audio: (track) => ({
    numberOfChannels: 1,
    bitrate: QUALITY_LOW,
    discard: track.number > 1,
  }),
  trim: { start: 0, end: 60 },
  tags: {}, // strip metadata
});
await conversion.execute();
```

### Watermark / overlay video

```ts
const watermark = new Image();
watermark.src = "/logo.png";
await new Promise((r) => (watermark.onload = r));

let ctx = null;
const conversion = await Conversion.init({
  input,
  output,
  video: {
    process: (sample) => {
      if (!ctx) {
        const canvas = new OffscreenCanvas(
          sample.displayWidth,
          sample.displayHeight,
        );
        ctx = canvas.getContext("2d");
      }
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      sample.draw(ctx, 0, 0);
      ctx.drawImage(watermark, 32, 32, 200, 80);
      return ctx.canvas;
    },
  },
});
await conversion.execute();
```

### Write large file directly to disk (File System API)

```ts
const handle = await window.showSaveFilePicker({ suggestedName: "output.mp4" });
const writable = await handle.createWritable();

const output = new Output({
  format: new Mp4OutputFormat(),
  target: new StreamTarget(writable, { chunked: true }),
});
// ... add tracks, start, add data ...
await output.finalize(); // automatically closes the writable stream
```

### Node.js: convert file on disk

```ts
import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  Mp4OutputFormat,
  FilePathSource,
  FilePathTarget,
} from "mediabunny";

using input = new Input({
  formats: ALL_FORMATS,
  source: new FilePathSource("/input/video.mkv"),
});
const output = new Output({
  format: new Mp4OutputFormat(),
  target: new FilePathTarget("/output/video.mp4"),
});
const conversion = await Conversion.init({ input, output });
await conversion.execute();
```

---

## 13. Pitfalls & Gotchas

| Pitfall                               | Fix                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `output.getMimeType()` never resolves | Don't await it before adding media data to tracks                                                                                      |
| Corrupt `StreamTarget` output         | Write each chunk at its `position` offset; don't concatenate unless format is append-only                                              |
| `FilePathSource` leaks file handles   | Always call `input.dispose()` or use `using input = ...`                                                                               |
| `Output` throws when adding tracks    | Tracks must be added before `output.start()`; check format compatibility with `getSupportedVideoCodecs()`                              |
| Conversion memory exhaustion          | For multi-track outputs with packet buffering, interleave data addition (video/audio alternating) rather than all-video then all-audio |
| `canDecode()` returns false           | Browser may not support codec; register a custom decoder or use `forceTranscode` to re-encode                                          |
| `isValid: false` on Conversion        | Check `discardedTracks[].reason`; most common: `no_encodable_target_codec` means no encoder available for the target format            |
| Negative start timestamps             | Don't render or play audio with negative timestamps; first valid frame is from `getFirstTimestamp()`                                   |
| `ALL_FORMATS` in a bundle             | Tree-shake with specific format constants (e.g. `[MP4, WEBM]`) to reduce bundle size                                                   |
