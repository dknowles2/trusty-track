/**
 * `MediaStreamTrackProcessor` (the Insertable Streams for MediaStreamTrack
 * API) has no ambient type in TypeScript's own `lib.dom.d.ts` — unlike
 * `VideoEncoder`/`EncodedVideoChunk`/`VideoFrame`, which TypeScript does
 * ship, this one is not yet part of the DOM lib TypeScript tracks. `capture.ts`
 * is the only caller; this file exists so it can reference the real
 * constructor and its `readable` stream rather than casting through
 * `unknown` at every call site.
 */

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

declare class MediaStreamTrackProcessor {
  constructor(init: MediaStreamTrackProcessorInit);
  readonly readable: ReadableStream<VideoFrame>;
}
