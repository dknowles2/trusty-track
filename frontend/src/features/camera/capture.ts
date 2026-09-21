/**
 * The WebCodecs capture pipeline (#177 stage 1b, revised after review):
 * `MediaStreamTrack` → `MediaStreamTrackProcessor` → `VideoFrame`s →
 * `VideoEncoder` → `ring.ts`'s `RingBuffer<EncodedFrame>`.
 *
 * **This replaced a `MediaRecorder`-based pipeline that produced unplayable
 * clips for nearly every real capture.** `MediaRecorder`'s container header
 * is emitted only in the very first timesliced `Blob` of a recording
 * session, and the ring's own age-based eviction discards that first chunk
 * like any other once the session has run longer than the ring's own
 * capacity (~10s) — which a camera opened before the first heat and left
 * running for the length of an event does within the first heat. Every cut
 * after that point was built from headerless `Cluster` fragments with
 * nothing for a decoder to configure itself from. This is the design the
 * issue itself specified (WebCodecs, not `MediaRecorder`); the earlier
 * version's own header explained why it departed from that design, and the
 * departure is what was wrong, not just under-tested.
 *
 * The fix has two halves, one in this file and one in `ring.ts`/`mux.ts`:
 *
 * 1. **A fresh keyframe roughly every second** (`KEYFRAME_INTERVAL_US`), so
 *    at any instant the ring holds a self-sufficient decode point from at
 *    most ~1s earlier — `ring.ts`'s own `coveringFromKeyframe` is what a cut
 *    reads off that.
 * 2. **A real muxer** (`mux.ts`, MIT `webm-muxer`) writes one correct WebM
 *    header for whatever chunks a cut hands it, every time — unlike
 *    `MediaRecorder`'s blob-per-slice output, muxing does not require the
 *    first chunk it is given to already carry a container header.
 *
 * `startCapture` is deliberately the *only* entry point for turning a
 * `MediaStreamTrack` into ring chunks — `Camera.tsx`'s real (`getUserMedia`)
 * and fake (`FakeCamera`'s canvas-captured) tracks both go through it, so
 * the encode/ring/mux/upload path under test in `FakeCamera` (and so in
 * `instantReplay.spec.ts`) is the *same* path a real capture takes, not a
 * shortcut around it — the previous version's fake path skipped this
 * pipeline entirely (a plain `fetch` of a canned file), which is why the
 * header/eviction bug above shipped with every automated check green.
 *
 * **`VideoFrame`s can also come from a canvas, not only from
 * `MediaStreamTrackProcessor`** (#1294) — WebKit has never shipped that API,
 * on iOS or on desktop, which used to mean this whole pipeline (and so the
 * camera page itself, gated on the processor's own existence in
 * `browserSupport.ts`) refused outright on every WebKit browser. `pickCodec`
 * and everything from `VideoEncoder` down are unchanged; only *where the
 * frames come from* differs, behind `frameSourceFor`. See that function's
 * own header for the two paths and what each hands the encoder.
 */

import type { RingBuffer } from './ring';

export interface EncodedFrame {
  /** A copy of the encoder's own bytes — `EncodedVideoChunk.copyTo` writes
   * into this rather than the chunk object surviving past its callback. */
  readonly data: Uint8Array;
  readonly isKeyframe: boolean;
  /** The encoder's own timestamp, microseconds — native WebCodecs units,
   * kept alongside `ring.ts`'s millisecond `startMs`/`endMs` because
   * `mux.ts`'s `addVideoChunkRaw` wants it in this unit untouched. */
  readonly timestampUs: number;
}

export interface VideoTrackInfo {
  /** The WebM codec id `mux.ts` writes into the file — `'V_VP9'`/`'V_VP8'`,
   * not the WebCodecs codec string those chunks were encoded with. */
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
}

/** ~1s — any cut point (`clipBounds.ts`'s own `t0 - preRoll`) is at most
 * this far from a keyframe the ring can start a valid clip on. Tighter
 * would cost more keyframe bytes for a proportionally larger encode;
 * looser would widen how far before the requested start a clip might
 * actually have to begin. */
const KEYFRAME_INTERVAL_US = 1_000_000;

const TARGET_BITRATE = 2_000_000;

/** Tried in order — VP9 first (smaller for the same quality), VP8 as the
 * fallback every WebCodecs implementation this app supports is expected to
 * have. Chosen with `VideoEncoder.isConfigSupported` against the track's
 * own negotiated resolution/frame rate, not assumed. */
const CANDIDATE_CODECS: ReadonlyArray<{ webCodecs: string; webm: string }> = [
  { webCodecs: 'vp09.00.10.08', webm: 'V_VP9' },
  { webCodecs: 'vp8', webm: 'V_VP8' },
];

async function pickCodec(
  width: number,
  height: number,
  framerate: number,
): Promise<{ webCodecs: string; webm: string } | null> {
  for (const candidate of CANDIDATE_CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.webCodecs,
        width,
        height,
        framerate,
      });
      if (support.supported) return candidate;
    } catch {
      // Try the next candidate — an unsupported config throws on some
      // implementations rather than reporting `supported: false`.
    }
  }
  return null;
}

/** `requestVideoFrameCallback`'s own `mediaTime` is seconds; every other
 * timestamp in this file (a processor-sourced `VideoFrame.timestamp`, an
 * `EncodedVideoChunk.timestamp`) is microseconds, WebCodecs' native unit —
 * this is the one place seconds cross that boundary. */
function mediaTimeToTimestampUs(mediaTimeSeconds: number): number {
  return Math.round(mediaTimeSeconds * 1_000_000);
}

interface RvfcMetadata {
  readonly mediaTime: number;
}

/**
 * Redraws `video` onto `canvas` on every decoded frame
 * (`requestVideoFrameCallback`), calling `onFrame` after each draw. Shared
 * by `fakeCameraTrack` below (canvas → `captureStream()`, an ordinary
 * `MediaStreamTrack`) and `canvasFrameSource` (canvas → `VideoFrame`,
 * WebKit's own fallback, #1294) — the redraw loop is identical between the
 * two, and only what each does with the freshly drawn canvas differs; this
 * is the one place either writes it.
 *
 * Falls back to `requestAnimationFrame` where `requestVideoFrameCallback`
 * does not exist — Safari shipped WebCodecs before it shipped rVFC on every
 * version in this app's own support matrix — synthesizing a `mediaTime`
 * off `video.currentTime`, which is exactly what rVFC's own metadata would
 * have reported.
 *
 * Returns a `stop` function; drawing continues, chained one
 * `requestVideoFrameCallback`/`requestAnimationFrame` at a time, until it
 * is called.
 */
function drawLoop(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  onFrame: (metadata: RvfcMetadata) => void,
): () => void {
  let stopped = false;
  const draw = (_now?: number, metadata?: RvfcMetadata) => {
    if (stopped) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onFrame(metadata ?? { mediaTime: video.currentTime });
    const withRvfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, metadata: RvfcMetadata) => void) => number;
    };
    if (withRvfc.requestVideoFrameCallback) {
      withRvfc.requestVideoFrameCallback(draw);
    } else {
      requestAnimationFrame(() => draw());
    }
  };
  draw();
  return () => {
    stopped = true;
  };
}

/** How many undelivered `VideoFrame`s `canvasFrameSource` will hold before
 * dropping the oldest — small, deliberately: each one holds real GPU memory
 * until `close()`d, and an encoder that has fallen this far behind is
 * already a case `RingBuffer`'s own age-based eviction handles downstream,
 * not something a bigger queue here would fix. */
const MAX_QUEUED_FALLBACK_FRAMES = 4;

/** The shape `startCapture`'s own `pump` loop actually calls —
 * `ReadableStreamDefaultReader<VideoFrame>` minus the parts it never uses,
 * so both `MediaStreamTrackProcessor().readable.getReader()` (the ordinary
 * path) and `canvasFrameSource` (the fallback, below) satisfy it
 * identically and `pump` never has to know which one it was handed. */
interface FrameSource {
  read(): Promise<ReadableStreamReadResult<VideoFrame>>;
  cancel(): Promise<void>;
}

/**
 * A `FrameSource` for `track` that does not need `MediaStreamTrackProcessor`
 * — WebKit has not shipped that API on iOS or on desktop
 * (`browserSupport.ts`'s `isAppleWebKit`), so this is what actually lights
 * the camera page up on an iPhone (#1294). `track` is played through a
 * hidden `<video>` element and redrawn onto an offscreen `<canvas>` on
 * every decoded frame (`drawLoop`, shared with `fakeCameraTrack` — this
 * file has no second copy of that loop), and each draw becomes
 * `new VideoFrame(canvas, { timestamp })`, timestamped off
 * `requestVideoFrameCallback`'s own `mediaTime` (`mediaTimeToTimestampUs`).
 * The result feeds `startCapture`'s `pump` loop exactly as a processor's
 * own reader would — same encoder, same keyframe cadence, same ring, same
 * mux and upload downstream; nothing past this function knows which frame
 * source produced what it is encoding.
 *
 * Every `VideoFrame` this produces is `close()`d exactly once — a WebCodecs
 * frame holds real GPU memory until then — either by whoever calls `read()`
 * (the same obligation the processor path already places on `pump`) or, if
 * `cancel()` runs first, by this function itself for anything still
 * queued.
 */
function canvasFrameSource(track: MediaStreamTrack): FrameSource {
  const video = document.createElement('video');
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;

  const canvas = document.createElement('canvas');
  let stopDrawing: (() => void) | null = null;
  let cancelled = false;

  const queue: VideoFrame[] = [];
  let waiting: ((result: ReadableStreamReadResult<VideoFrame>) => void) | null = null;

  const enqueue = (frame: VideoFrame) => {
    if (cancelled) {
      frame.close();
      return;
    }
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve({ done: false, value: frame });
      return;
    }
    queue.push(frame);
    while (queue.length > MAX_QUEUED_FALLBACK_FRAMES) queue.shift()?.close();
  };

  const ready = (async () => {
    await video.play().catch(() => {});
    if (cancelled) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve) => {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      });
    }
    if (cancelled) return;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable.');
    stopDrawing = drawLoop(video, canvas, ctx, (metadata) => {
      enqueue(new VideoFrame(canvas, { timestamp: mediaTimeToTimestampUs(metadata.mediaTime) }));
    });
  })();

  return {
    async read() {
      await ready.catch(() => {});
      if (cancelled) return { done: true, value: undefined };
      const queued = queue.shift();
      if (queued) return { done: false, value: queued };
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    async cancel() {
      cancelled = true;
      stopDrawing?.();
      const pending = waiting;
      waiting = null;
      pending?.({ done: true, value: undefined });
      queue.splice(0).forEach((f) => f.close());
      video.pause();
      video.srcObject = null;
    },
  };
}

/**
 * Whether `startCapture` should use `canvasFrameSource` rather than
 * `MediaStreamTrackProcessor` — pulled out as its own pure-ish function
 * (still reads the global, but takes no track and touches nothing else) so
 * a test can assert on the choice without driving a real capture through
 * either path. `forceFallback` is `Camera.tsx`'s `?noProcessor=1`, the same
 * one-shot-override shape `?ringMs=` already is: a real camera never sets
 * it, and `instantReplay.spec.ts` uses it to exercise this path in a
 * browser that does carry the processor.
 */
export function usesFallbackFrameSource(
  forceFallback: boolean,
  g: typeof globalThis = globalThis,
): boolean {
  const w = g as unknown as { MediaStreamTrackProcessor?: unknown };
  return forceFallback || typeof w.MediaStreamTrackProcessor === 'undefined';
}

function frameSourceFor(track: MediaStreamTrack, forceFallback: boolean): FrameSource {
  if (usesFallbackFrameSource(forceFallback)) return canvasFrameSource(track);
  return new MediaStreamTrackProcessor({ track }).readable.getReader();
}

export interface CaptureHandle {
  /** What the encoder actually configured with — the track's own negotiated
   * width/height/frame rate, not a guess, since `mux.ts` has to declare the
   * identical dimensions the encoded bytes were produced at. */
  readonly track: VideoTrackInfo;
  /** Stops reading frames, flushes and closes the encoder. Idempotent. */
  stop(): Promise<void>;
}

/**
 * Starts encoding `track` into `ring`, forcing a keyframe at least once per
 * `KEYFRAME_INTERVAL_US`. Rejects if no candidate codec is supported for
 * this track's own resolution — the caller's job to report that, same as
 * any other capture failure.
 *
 * `options.forceFallback` is `Camera.tsx`'s `?noProcessor=1` test hook
 * (#1294) — see `usesFallbackFrameSource`'s own doc comment. A real camera
 * never sets it; `frameSourceFor` picks the fallback on its own whenever
 * `MediaStreamTrackProcessor` is genuinely absent, which is every WebKit
 * browser today.
 */
export async function startCapture(
  track: MediaStreamTrack,
  ring: RingBuffer<EncodedFrame>,
  onError: (error: unknown) => void,
  options: { forceFallback?: boolean } = {},
): Promise<CaptureHandle> {
  const settings = track.getSettings();
  const width = settings.width ?? 1280;
  const height = settings.height ?? 720;
  const frameRate = settings.frameRate ?? 30;

  const codec = await pickCodec(width, height, frameRate);
  if (!codec) {
    throw new Error('No supported video codec for this camera.');
  }

  // `VideoFrame`/`EncodedVideoChunk` timestamps are microseconds against the
  // track's *own* reference clock — not wall-clock epoch time, and not
  // guaranteed to start anywhere near 0. `clipBounds.ts`'s `bounds.startMs`/
  // `endMs` are `Date.now()`-based epoch milliseconds (`latestRunningAt`
  // parses the server's own ISO timestamp), so a cut against the ring
  // needs both sides in the same clock. `originOffsetMs`, fixed from the
  // very first frame this session sees, is that bridge: every later
  // timestamp is a fixed real-time distance from that first one (both
  // clocks run at the same rate — only their epochs differ), so `Date.now()
  // - firstFrame.timestamp/1000` computed once and added to every
  // subsequent `chunk.timestamp/1000` recovers wall-clock time throughout
  // the session. Getting this wrong doesn't fail loudly: `ring.
  // coveringFromKeyframe`'s bound comparisons still "succeed" against
  // whatever chunks exist (wrong ones), and the resulting garbage
  // `t0OffsetMs` only surfaces later, server-side, as a silent GraphQL Int32
  // overflow on `heatReplay` — found by `instantReplay.spec.ts` actually
  // running in a real browser rather than by any unit test, since jsdom has
  // no WebCodecs to have gotten this wrong against.
  let originOffsetMs: number | null = null;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      if (originOffsetMs === null) return; // no frame has set the origin yet
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const durationUs = chunk.duration ?? 0;
      const startMs = originOffsetMs + chunk.timestamp / 1000;
      ring.push({
        startMs,
        endMs: startMs + durationUs / 1000,
        isKeyframe: chunk.type === 'key',
        data: { data, isKeyframe: chunk.type === 'key', timestampUs: chunk.timestamp },
      });
    },
    error: onError,
  });
  encoder.configure({ codec: codec.webCodecs, width, height, framerate: frameRate, bitrate: TARGET_BITRATE });

  const reader = frameSourceFor(track, options.forceFallback ?? false);

  let stopped = false;
  let lastKeyframeUs = -Infinity;

  const pump = (async () => {
    for (;;) {
      let result: ReadableStreamReadResult<VideoFrame>;
      try {
        result = await reader.read();
      } catch (error) {
        if (!stopped) onError(error);
        return;
      }
      if (result.done || stopped) {
        result.value?.close();
        return;
      }
      const frame = result.value;
      if (originOffsetMs === null) originOffsetMs = Date.now() - frame.timestamp / 1000;
      const forceKeyframe = frame.timestamp - lastKeyframeUs >= KEYFRAME_INTERVAL_US;
      if (forceKeyframe) lastKeyframeUs = frame.timestamp;
      try {
        encoder.encode(frame, { keyFrame: forceKeyframe });
      } catch (error) {
        onError(error);
      } finally {
        frame.close();
      }
    }
  })();

  return {
    track: { codec: codec.webm, width, height, frameRate },
    async stop() {
      if (stopped) return;
      stopped = true;
      await reader.cancel().catch(() => {});
      await pump;
      if (encoder.state !== 'closed') {
        try {
          await encoder.flush();
        } catch {
          // A frame mid-encode when stop() was called — nothing left to do
          // with a flush failure but close anyway.
        }
        encoder.close();
      }
    },
  };
}

/**
 * A `MediaStreamTrack` sourced from `fake-camera.webm` rather than a real
 * device (#177 stage 1b's `FakeCamera`) — a hidden, looping `<video>` drawn
 * to an offscreen `<canvas>` on every decoded frame (`drawLoop`, shared
 * with `canvasFrameSource` above), captured from the canvas rather than the
 * video element directly: `HTMLVideoElement.captureStream` is a
 * non-standard extension with no TypeScript type in this tree, where
 * `HTMLCanvasElement.captureStream` is standard. Looped so a test driving
 * more than one heat — long enough to prove a clip cut after the ring has
 * evicted its *original* keyframe still decodes (`instantReplay.spec.ts`'s
 * own post-eviction case) — has a source longer than the file's own 3s.
 */
export async function fakeCameraTrack(url = '/fake-camera.webm'): Promise<{
  track: MediaStreamTrack;
  stop: () => void;
}> {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  await video.play();

  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable.');

  const stopDrawing = drawLoop(video, canvas, ctx, () => {});

  const stream = canvas.captureStream();
  const [track] = stream.getVideoTracks();
  if (!track) throw new Error('canvas.captureStream() produced no video track.');

  return {
    track,
    stop: () => {
      stopDrawing();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
