/** Stop every track owned by the supplied capture streams. */
export function stopMediaStreams(
  ...streams: (Pick<MediaStream, "getTracks"> | null)[]
): void {
  for (const stream of streams) {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
