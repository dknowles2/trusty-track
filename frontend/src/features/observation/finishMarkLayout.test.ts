import { describe, expect, it } from 'vitest';
import { layoutFinishMarks, rowCount, MAX_ROWS } from './finishMarkLayout';

const DURATION_MS = 8000;

describe('layoutFinishMarks', () => {
  it('places every mark on row 0 with no collision', () => {
    const marks = [
      { lane: 1, atMs: 1000 },
      { lane: 2, atMs: 5000 },
      { lane: 3, atMs: 7000 },
    ];

    const positions = layoutFinishMarks(marks, DURATION_MS, 5);

    expect(positions.every((p) => p.row === 0)).toBe(true);
    expect(positions.map((p) => p.leftPct)).toEqual([12.5, 62.5, 87.5]);
  });

  it('stacks a two-way collision onto a second row', () => {
    // 3400ms and 3410ms of an 8000ms clip: leftPct 42.5 and 42.625 — 0.125
    // apart, well inside a minGapPct of 5.
    const marks = [
      { lane: 1, atMs: 3400 },
      { lane: 2, atMs: 3410 },
    ];

    const positions = layoutFinishMarks(marks, DURATION_MS, 5);

    const byLane = new Map(positions.map((p) => [p.lane, p]));
    expect(byLane.get(1)?.row).toBe(0);
    expect(byLane.get(2)?.row).toBe(1);
  });

  it('stacks a three-way collision onto three separate rows', () => {
    const marks = [
      { lane: 1, atMs: 3400 },
      { lane: 2, atMs: 3410 },
      { lane: 3, atMs: 3420 },
    ];

    const positions = layoutFinishMarks(marks, DURATION_MS, 5);

    const rows = positions.map((p) => p.row).sort();
    expect(rows).toEqual([0, 1, 2]);
  });

  it('keeps an exact tie (equal atMs) on separate rows — both stay clickable', () => {
    const marks = [
      { lane: 1, atMs: 3400 },
      { lane: 2, atMs: 3400 },
    ];

    const positions = layoutFinishMarks(marks, DURATION_MS, 5);

    const byLane = new Map(positions.map((p) => [p.lane, p]));
    expect(byLane.get(1)?.leftPct).toBe(byLane.get(2)?.leftPct);
    expect(byLane.get(1)?.row).not.toBe(byLane.get(2)?.row);
  });

  it('never places two marks on the same row within minGapPct of each other', () => {
    // A sweep of nearly-adjacent marks, bounded to MAX_ROWS collisions at
    // once so the guarantee genuinely holds (see the module's own doc
    // comment on what happens past that cap).
    const minGapPct = 5;
    const marks = Array.from({ length: MAX_ROWS }, (_, i) => ({
      lane: i + 1,
      atMs: 3000 + i * 1, // 1ms apart — well within minGapPct at this duration
    }));

    const positions = layoutFinishMarks(marks, DURATION_MS, minGapPct);

    const byRow = new Map<number, number[]>();
    for (const p of positions) {
      const list = byRow.get(p.row) ?? [];
      list.push(p.leftPct);
      byRow.set(p.row, list);
    }
    for (const leftPcts of byRow.values()) {
      const sorted = [...leftPcts].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(minGapPct);
      }
    }
  });

  it('does not reorder by lane, only by atMs, regardless of input order', () => {
    const marks = [
      { lane: 5, atMs: 6000 },
      { lane: 1, atMs: 1000 },
      { lane: 3, atMs: 3000 },
    ];

    const positions = layoutFinishMarks(marks, DURATION_MS, 5);

    expect(positions.map((p) => p.lane)).toEqual([1, 3, 5]);
  });

  it('is a no-op collision-wise on a zero-duration clip (leftPct all 0)', () => {
    const marks = [
      { lane: 1, atMs: 0 },
      { lane: 2, atMs: 0 },
    ];

    const positions = layoutFinishMarks(marks, 0, 5);

    expect(positions.every((p) => p.leftPct === 0)).toBe(true);
    // Still separated onto different rows, since 0 - 0 < minGapPct.
    const rows = positions.map((p) => p.row);
    expect(new Set(rows).size).toBe(2);
  });
});

describe('rowCount', () => {
  it('is 1 for an empty list', () => {
    expect(rowCount([])).toBe(1);
  });

  it('is the highest row plus one', () => {
    expect(rowCount([{ row: 0 }, { row: 2 }, { row: 1 }])).toBe(3);
  });
});
