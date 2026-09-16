/**
 * A rolling window of captured clip chunks (#177 stage 1b).
 *
 * The camera records in small time-sliced pieces (`MediaRecorder`'s own
 * `timeslice`) rather than one long recording, so a chunk can be evicted
 * once it falls outside the window a clip cut could ever need — the ring
 * this module names. Each chunk knows its own wall-clock span
 * (`startMs`/`endMs`, `Date.now()`-based), which is what lets `clipBounds.ts`
 * ask for "everything between these two instants" without this module
 * knowing anything about timers, heats, or video.
 *
 * Pure and framework-free, the same reasoning `domain/scheduling.py` gives
 * for keeping a rule importable with nothing else running: this is
 * exercised in `ring.test.ts` with plain fake chunks — no `MediaRecorder`,
 * no DOM.
 */

export interface RingChunk<T> {
  readonly startMs: number;
  readonly endMs: number;
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
   * The chunks whose span overlaps `[fromMs, toMs]` at all, oldest first —
   * what a clip cut needs (`clipBounds.ts`'s own bounds), not an exact trim:
   * the caller muxes whichever of the returned chunks it can, and the actual
   * cut is only as fine as one chunk's own `timeslice` — the trade-off
   * `Camera.tsx`'s own module docs name in full.
   */
  covering(fromMs: number, toMs: number): RingChunk<T>[] {
    return this.chunks.filter((chunk) => chunk.endMs >= fromMs && chunk.startMs <= toMs);
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
