/**
 * Proctoring snapshot worker — receives camera frames as ImageBitmap,
 * downscales and JPEG-encodes them on a worker thread via OffscreenCanvas,
 * and posts back compressed blobs for AI analysis / upload.
 */

interface CompressMessage {
  type: "compress";
  bitmap: ImageBitmap;
  maxWidth: number;
  quality: number;
}

type InMessage = CompressMessage;

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (msg.type !== "compress") return;

  const { bitmap, maxWidth, quality } = msg;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    (self as unknown as Worker).postMessage({ type: "error", error: "no-2d" });
    return;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  (self as unknown as Worker).postMessage({ type: "compressed", blob }, [blob]);
};

export {};
