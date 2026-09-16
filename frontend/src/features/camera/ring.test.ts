import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ring';

function chunk(startMs: number, endMs: number, data = 'x') {
  return { startMs, endMs, data };
}

describe('RingBuffer', () => {
  it('holds chunks within the capacity window', () => {
    const ring = new RingBuffer<string>(10_000);
    ring.push(chunk(0, 1000));
    ring.push(chunk(1000, 2000));
    expect(ring.all()).toHaveLength(2);
    expect(ring.spanMs()).toBe(2000);
  });

  it('evicts a chunk once it ages out of the capacity window', () => {
    const ring = new RingBuffer<string>(3000);
    ring.push(chunk(0, 1000));
    ring.push(chunk(1000, 2000));
    // The newest chunk's own endMs is what eviction is measured against —
    // a chunk entirely older than capacityMs before it is gone.
    ring.push(chunk(2000, 5000));
    expect(ring.all().map((c) => c.startMs)).toEqual([1000, 2000]);
  });

  it('evicts more than one aged chunk in one push', () => {
    const ring = new RingBuffer<string>(1000);
    ring.push(chunk(0, 500));
    ring.push(chunk(500, 900));
    ring.push(chunk(900, 5000));
    expect(ring.all()).toHaveLength(1);
    expect(ring.all()[0].startMs).toBe(900);
  });

  it('never evicts down to nothing while chunks keep arriving', () => {
    const ring = new RingBuffer<string>(500);
    for (let i = 0; i < 50; i++) {
      ring.push(chunk(i * 250, i * 250 + 250));
    }
    expect(ring.all().length).toBeGreaterThan(0);
    expect(ring.spanMs()).toBeLessThanOrEqual(750); // capacity + one chunk's own width
  });

  describe('covering', () => {
    it('returns every chunk overlapping the requested window', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, 'a'));
      ring.push(chunk(250, 500, 'b'));
      ring.push(chunk(500, 750, 'c'));
      ring.push(chunk(750, 1000, 'd'));

      const covering = ring.covering(400, 800);
      expect(covering.map((c) => c.data)).toEqual(['b', 'c', 'd']);
    });

    it('returns an empty list when nothing overlaps', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, 'a'));
      expect(ring.covering(10_000, 20_000)).toEqual([]);
    });

    it('includes a chunk whose span only just touches the window edge', () => {
      const ring = new RingBuffer<string>(60_000);
      ring.push(chunk(0, 250, 'a'));
      expect(ring.covering(250, 500)).toHaveLength(1);
    });
  });

  it('spanMs is 0 for an empty ring', () => {
    expect(new RingBuffer<string>(1000).spanMs()).toBe(0);
  });

  it('clear empties the ring', () => {
    const ring = new RingBuffer<string>(1000);
    ring.push(chunk(0, 500));
    ring.clear();
    expect(ring.all()).toEqual([]);
    expect(ring.spanMs()).toBe(0);
  });
});
