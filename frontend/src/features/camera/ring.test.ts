import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring';

function chunk(startMs: number, endMs: number, isKeyframe: boolean, data = 'x') {
  return { startMs, endMs, isKeyframe, data };
}

describe('RingBuffer', () => {
  it('holds chunks within the capacity window', () => {
    const ring = new RingBuffer<string>(10_000);
    ring.push(chunk(0, 1000, true));
    ring.push(chunk(1000, 2000, false));
    expect(ring.all()).toHaveLength(2);
    expect(ring.spanMs()).toBe(2000);
  });

  it('evicts a chunk once it ages out of the capacity window', () => {
    const ring = new RingBuffer<string>(3000);
    ring.push(chunk(0, 1000, true));
    ring.push(chunk(1000, 2000, false));
    // The newest chunk's own endMs is what eviction is measured against —
    // a chunk entirely older than capacityMs before it is gone.
    ring.push(chunk(2000, 5000, true));
    expect(ring.all().map((c) => c.startMs)).toEqual([1000, 2000]);
  });

  it('evicts more than one aged chunk in one push', () => {
    const ring = new RingBuffer<string>(1000);
    ring.push(chunk(0, 500, true));
    ring.push(chunk(500, 900, false));
    ring.push(chunk(900, 5000, true));
    expect(ring.all()).toHaveLength(1);
    expect(ring.all()[0].startMs).toBe(900);
  });

  it('never evicts down to nothing while chunks keep arriving', () => {
    const ring = new RingBuffer<string>(500);
    for (let i = 0; i < 50; i++) {
      ring.push(chunk(i * 250, i * 250 + 250, i % 4 === 0));
    }
    expect(ring.all().length).toBeGreaterThan(0);
    expect(ring.spanMs()).toBeLessThanOrEqual(750); // capacity + one chunk's own width
  });

  it('spanMs is 0 for an empty ring', () => {
    expect(new RingBuffer<string>(1000).spanMs()).toBe(0);
  });

  it('clear empties the ring', () => {
    const ring = new RingBuffer<string>(1000);
    ring.push(chunk(0, 500, true));
    ring.clear();
    expect(ring.all()).toEqual([]);
    expect(ring.spanMs()).toBe(0);
  });

  describe('coveringFromKeyframe', () => {
    it('starts the cut at the most recent keyframe at or before fromMs', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, true, 'key0'));
      ring.push(chunk(250, 500, false, 'd1'));
      ring.push(chunk(500, 750, true, 'key1'));
      ring.push(chunk(750, 1000, false, 'd2'));
      ring.push(chunk(1000, 1250, false, 'd3'));

      // fromMs=900 falls between key1 (750) and the next keyframe (none
      // yet) — the cut has to start at key1, not at d2/d3.
      const covering = ring.coveringFromKeyframe(900, 1200);
      expect(covering.map((c) => c.data)).toEqual(['key1', 'd2', 'd3']);
    });

    it('never starts a cut on a delta frame — this is the bug the previous MediaRecorder-based ring let through', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, true, 'key0'));
      ring.push(chunk(250, 500, false, 'd1'));
      ring.push(chunk(500, 750, false, 'd2'));
      const covering = ring.coveringFromKeyframe(600, 800);
      expect(covering[0].isKeyframe).toBe(true);
      expect(covering[0].data).toBe('key0');
    });

    it('falls back to the earliest keyframe the ring holds when fromMs is before any keyframe old enough', () => {
      const ring = new RingBuffer<string>(60_000);
      // The ring's very first chunk is a keyframe (a camera that has just
      // started), and fromMs asks for a moment before it.
      ring.push(chunk(1000, 1250, true, 'key0'));
      ring.push(chunk(1250, 1500, false, 'd1'));
      const covering = ring.coveringFromKeyframe(0, 1400);
      expect(covering.map((c) => c.data)).toEqual(['key0', 'd1']);
    });

    it('returns every chunk up to and including toMs, none after', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, true, 'key0'));
      ring.push(chunk(250, 500, false, 'd1'));
      ring.push(chunk(500, 750, false, 'd2'));
      ring.push(chunk(750, 1000, true, 'key1'));
      const covering = ring.coveringFromKeyframe(0, 600);
      expect(covering.map((c) => c.data)).toEqual(['key0', 'd1', 'd2']);
    });

    it('returns [] when the ring holds no keyframe at all', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, false, 'd0'));
      ring.push(chunk(250, 500, false, 'd1'));
      expect(ring.coveringFromKeyframe(0, 400)).toEqual([]);
    });

    it('returns [] for an empty ring', () => {
      const ring = new RingBuffer<string>(60_000);
      expect(ring.coveringFromKeyframe(0, 1000)).toEqual([]);
    });

    it('the post-eviction case: a cut long after the ring has evicted its original opening keyframe still starts on a valid one', () => {
      // Simulates `capture.ts`'s own ~1s keyframe cadence over a session far
      // longer than the ring's 10s capacity — chunk 0's own keyframe is long
      // gone, but a fresh one has always landed within the last second.
      const ring = new RingBuffer<string>(10_000);
      let t = 0;
      for (let second = 0; second < 30; second++) {
        // One keyframe, then three delta frames, each second — a stand-in
        // for a real encoder's ~4 chunks/s at this timeslice.
        ring.push(chunk(t, t + 250, true, `key@${t}`));
        t += 250;
        for (let i = 0; i < 3; i++) {
          ring.push(chunk(t, t + 250, false, `d@${t}`));
          t += 250;
        }
      }
      // 30s of encoding into a 10s ring — chunk 0 (t=0) is long evicted.
      expect(ring.all()[0].startMs).toBeGreaterThan(10_000);

      // Cut a clip well past the eviction point.
      const covering = ring.coveringFromKeyframe(25_000, 25_500);
      expect(covering.length).toBeGreaterThan(0);
      expect(covering[0].isKeyframe).toBe(true);
      expect(covering[0].startMs).toBeLessThanOrEqual(25_000);
    });
  });
});
