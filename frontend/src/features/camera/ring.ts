/**
 * A rolling window of encoded video chunks (#177 stage 1b).
 *
 * The camera encodes continuously through `capture.ts`'s `VideoEncoder`
 * pipeline, one `EncodedVideoChunk` at a time, so a chunk can be evicted
 * once it falls outside the window a clip cut could ever need — the ring
 * this module names. Each chunk knows its own wall-clock span
 * (`startMs`/`endMs`, derived from the encoder's own microsecond
 * timestamps), which is what lets `clipBounds.ts` ask for "everything
 * between these two instants" without this module knowing anything about
 * timers, heats, or video.
 *
 * **Age-based eviction alone is not enough to cut a valid clip — a VP8/VP9
 * delta frame only decodes once every frame it depends on, back to the last
 * keyframe, has decoded first.** A cut that starts mid-GOP (a delta frame
 * with no preceding keyframe in the file at all) is not a `<video>`-playable
 * file, whatever container wraps it — this is what made the `MediaRecorder`
 * version of this file wrong: it kept a `Blob` per timeslice and relied on
 * chunk 0 alone carrying the *container* header, which eviction discarded
 * the moment the ring's own window moved past it, with nothing re-supplying
 * one. `capture.ts` now forces a fresh keyframe roughly every second
 * (`KEYFRAME_INTERVAL_US`), so at any instant the ring holds a keyframe from
 * at most ~1s earlier — `coveringFromKeyframe` is what a cut actually asks
 * for: the most recent keyframe at or before the window starts, through
 * every chunk up to where it ends. The *container* header is no longer this
 * module's problem at all — `mux.ts` writes one fresh, correct header for
 * whatever chunks it is handed, every time, because muxing (unlike
 * `MediaRecorder`'s own blob-per-slice output) does not require the first
 * chunk fed to it to already carry one.
 *
 * Pure and framework-free, the same reasoning `domain/scheduling.py` gives
 * for keeping a rule importable with nothing else running: this is
 * exercised in `ring.test.ts` with plain fake chunks — no `MediaRecorder`,
 * no WebCodecs, no DOM.
 */

export interface RingChunk<T> {
  readonly startMs: number;
  readonly endMs: number;
  readonly isKeyframe: boolean;
  readonly data: T;
}

export class RingBuffer<T> {
  private chunks: RingChunk<T>[] = [];

  /** @param capacityMs how much history to keep — the issue's own ~10s. */
  constructor(private readonly capacityMs: number) {}

  /** Add a chunk, then evict anything that has aged out of the window. */
  push(chunk: RingChunk<T>): void {
    this.chunks.push(chunk);
    this.evict(chunk.endMs);
  }

  private evict(nowMs: number): void {
    const cutoff = nowMs - this.capacityMs;
    while (this.chunks.length > 0 && this.chunks[0].endMs < cutoff) {
      this.chunks.shift();
    }
  }

  /** Every chunk currently held, oldest first. */
  all(): readonly RingChunk<T>[] {
    return this.chunks;
  }

  /**
   * The chunks a clip covering `[fromMs, toMs]` needs to actually decode:
   * the most recent keyframe at or before `fromMs` (falling back to the
   * *earliest* keyframe the ring still holds, if the window starts before
   * any keyframe old enough — the case a camera that has just opened, or a
   * cut near the very start of the ring's own retained span, lands in),
   * through every following chunk up to `toMs`. Returns `[]` if the ring
   * holds no keyframe at all yet, which `capture.ts`'s own cut caller reads
   * as "nothing to upload for this result."
   *
   * The returned first chunk's own `startMs` is very often *earlier* than
   * `fromMs` was asked for — that is the point, not a bug: a valid clip has
   * to start on a keyframe, and the caller recomputes `t0OffsetMs` against
   * wherever this actually begins rather than the originally requested
   * bound.
   */
  coveringFromKeyframe(fromMs: number, toMs: number): RingChunk<T>[] {
    let keyIndex = -1;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i].isKeyframe && this.chunks[i].startMs <= fromMs) {
        keyIndex = i;
        break;
      }
    }
    if (keyIndex === -1) {
      keyIndex = this.chunks.findIndex((chunk) => chunk.isKeyframe);
    }
    if (keyIndex === -1) return [];
    return this.chunks.slice(keyIndex).filter((chunk) => chunk.startMs <= toMs);
  }

  /** How much history is currently held, in ms — `0` for an empty ring. */
  spanMs(): number {
    if (this.chunks.length === 0) return 0;
    return this.chunks[this.chunks.length - 1].endMs - this.chunks[0].startMs;
  }

  clear(): void {
    this.chunks = [];
  }
}
