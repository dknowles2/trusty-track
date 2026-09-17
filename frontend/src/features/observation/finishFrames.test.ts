import { describe, expect, it } from 'vitest';
import {
  finishMarks,
  isWithinSlowMotionWindow,
  slowMotionWindow,
  SLOW_MOTION_LEAD_MS,
  SLOW_MOTION_TAIL_MS,
  type LaneResultLike,
} from './finishFrames';

const CLIP = { t0OffsetMs: 1500, durationMs: 6000 };

describe('finishMarks', () => {
  it('places a mark at t0Offset plus the lane time, in seconds', () => {
    const lanes: LaneResultLike[] = [{ lane: 1, racerName: 'A', time: 3.076 }];

    const marks = finishMarks(CLIP, lanes);

    expect(marks).toEqual([{ lane: 1, racerName: 'A', timeS: 3.076, atMs: 1500 + 3076 }]);
  });

  it('sorts by crossing time, first across the line first', () => {
    const lanes: LaneResultLike[] = [
      { lane: 1, racerName: 'Slow', time: 4.0 },
      { lane: 2, racerName: 'Fast', time: 3.0 },
    ];

    const marks = finishMarks(CLIP, lanes);

    expect(marks.map((m) => m.lane)).toEqual([2, 1]);
  });

  it('excludes a DNF (a non-positive time)', () => {
    const lanes: LaneResultLike[] = [
      { lane: 1, racerName: 'A', time: 3.0 },
      { lane: 2, racerName: 'B', time: 0 },
      { lane: 3, racerName: 'C', time: -1 },
    ];

    expect(finishMarks(CLIP, lanes).map((m) => m.lane)).toEqual([1]);
  });

  it('excludes a skipped lane even if it somehow carries a time', () => {
    const lanes: LaneResultLike[] = [{ lane: 1, racerName: 'A', time: 3.0, skipped: true }];

    expect(finishMarks(CLIP, lanes)).toEqual([]);
  });

  it('excludes a lane with no time recorded at all', () => {
    const lanes: LaneResultLike[] = [{ lane: 1, racerName: 'A', time: null }];

    expect(finishMarks(CLIP, lanes)).toEqual([]);
  });

  it('excludes a mark that would fall beyond the clip’s own duration, rather than clamping it', () => {
    // t0Offset 1500 + 5000ms = 6500ms, past this clip's 6000ms duration.
    const lanes: LaneResultLike[] = [{ lane: 1, racerName: 'Late', time: 5.0 }];

    expect(finishMarks(CLIP, lanes)).toEqual([]);
  });

  it('keeps a mark that lands exactly on the last frame', () => {
    // t0Offset 1500 + 4500ms = 6000ms, exactly durationMs.
    const lanes: LaneResultLike[] = [{ lane: 1, racerName: 'Right At The End', time: 4.5 }];

    expect(finishMarks(CLIP, lanes)).toHaveLength(1);
  });

  it('produces no marks for an empty lane list', () => {
    expect(finishMarks(CLIP, [])).toEqual([]);
  });
});

describe('slowMotionWindow', () => {
  it('is null with no marks', () => {
    expect(slowMotionWindow([], 6000)).toBeNull();
  });

  it('spans from one second before the (single) finish to 200ms after it', () => {
    const marks = [{ lane: 1, racerName: 'A', timeS: 3.0, atMs: 4500 }];

    const window = slowMotionWindow(marks, 6000);

    expect(window).toEqual({
      startMs: 4500 - SLOW_MOTION_LEAD_MS,
      endMs: 4500 + SLOW_MOTION_TAIL_MS,
    });
  });

  it('spans from one second before the first finish to 200ms after the last, with several marks', () => {
    const marks = [
      { lane: 1, racerName: 'First', timeS: 3.0, atMs: 4500 },
      { lane: 2, racerName: 'Last', timeS: 3.4, atMs: 4900 },
    ];

    const window = slowMotionWindow(marks, 6000);

    expect(window).toEqual({ startMs: 3500, endMs: 5100 });
  });

  it('clamps the start to the beginning of the clip', () => {
    const marks = [{ lane: 1, racerName: 'A', timeS: 0.5, atMs: 500 }];

    const window = slowMotionWindow(marks, 6000);

    expect(window?.startMs).toBe(0);
  });

  it('clamps the end to the end of the clip', () => {
    const marks = [{ lane: 1, racerName: 'A', timeS: 3.0, atMs: 5950 }];

    const window = slowMotionWindow(marks, 6000);

    expect(window?.endMs).toBe(6000);
  });

  it('is null when the clamped start and end no longer leave a real span', () => {
    // A mark beyond `durationMs` (finishMarks itself would already have
    // excluded this — slowMotionWindow is a separate pure function and
    // has to be safe against being handed one anyway): the clamped end
    // (durationMs) lands before the clamped start (atMs - lead), so there
    // is no window left to slow down.
    const marks = [{ lane: 1, racerName: 'A', timeS: 2.0, atMs: 2000 }];

    const window = slowMotionWindow(marks, 100);

    expect(window).toBeNull();
  });
});

describe('isWithinSlowMotionWindow', () => {
  const window = { startMs: 1000, endMs: 2000 };

  it('is false with no window at all', () => {
    expect(isWithinSlowMotionWindow(1500, null)).toBe(false);
  });

  it('is true inside the window, inclusive of both ends', () => {
    expect(isWithinSlowMotionWindow(1000, window)).toBe(true);
    expect(isWithinSlowMotionWindow(1500, window)).toBe(true);
    expect(isWithinSlowMotionWindow(2000, window)).toBe(true);
  });

  it('is false outside the window', () => {
    expect(isWithinSlowMotionWindow(999, window)).toBe(false);
    expect(isWithinSlowMotionWindow(2001, window)).toBe(false);
  });
});
