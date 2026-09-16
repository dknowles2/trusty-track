import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POST_ROLL_MS,
  DEFAULT_PRE_ROLL_MS,
  NONE_FALLBACK_SKIPBACK_MS,
  correctedT0Ms,
  latestRunningAt,
  medianMs,
  noneFallbackBounds,
  timerSyncedBounds,
  type Transition,
} from './clipBounds';

describe('latestRunningAt', () => {
  it('finds the most recent RUNNING transition', () => {
    const transitions: Transition[] = [
      { toState: 'ARMED', at: '2026-01-01T00:00:00.000Z' },
      { toState: 'RUNNING', at: '2026-01-01T00:00:05.000Z' },
      { toState: 'IDLE', at: '2026-01-01T00:00:08.000Z' },
    ];
    expect(latestRunningAt(transitions)).toBe(Date.parse('2026-01-01T00:00:05.000Z'));
  });

  it('picks the later of two RUNNING transitions, across two heats', () => {
    const transitions: Transition[] = [
      { toState: 'RUNNING', at: '2026-01-01T00:00:05.000Z' },
      { toState: 'IDLE', at: '2026-01-01T00:00:08.000Z' },
      { toState: 'ARMED', at: '2026-01-01T00:01:00.000Z' },
      { toState: 'RUNNING', at: '2026-01-01T00:01:05.000Z' },
    ];
    expect(latestRunningAt(transitions)).toBe(Date.parse('2026-01-01T00:01:05.000Z'));
  });

  it('returns null when the log carries no RUNNING transition — a NONE track', () => {
    const transitions: Transition[] = [
      { toState: 'IDLE', at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(latestRunningAt(transitions)).toBeNull();
  });

  it('returns null for an empty log', () => {
    expect(latestRunningAt([])).toBeNull();
  });

  it('ignores an unparseable timestamp rather than throwing', () => {
    const transitions: Transition[] = [{ toState: 'RUNNING', at: 'not-a-date' }];
    expect(latestRunningAt(transitions)).toBeNull();
  });
});

describe('correctedT0Ms', () => {
  it('adds half the measured RTT back onto the server timestamp', () => {
    expect(correctedT0Ms(1000, 40)).toBe(1020);
  });

  it('is a no-op at zero RTT', () => {
    expect(correctedT0Ms(1000, 0)).toBe(1000);
  });
});

describe('medianMs', () => {
  it('is the middle value of an odd-length sample', () => {
    expect(medianMs([30, 10, 20])).toBe(20);
  });

  it('averages the two middle values of an even-length sample', () => {
    expect(medianMs([10, 20, 30, 40])).toBe(25);
  });

  it('is robust to one slow outlier, unlike a mean', () => {
    // A mean of these four would be pulled well past 30 by the outlier;
    // the median is not, which is the whole reason it was chosen.
    expect(medianMs([18, 20, 22, 500])).toBe(21);
  });

  it('is 0 for no samples', () => {
    expect(medianMs([])).toBe(0);
  });

  it('is the value itself for one sample', () => {
    expect(medianMs([42])).toBe(42);
  });
});

describe('timerSyncedBounds', () => {
  it('brackets t0 by the default pre/post roll when every lane is fast', () => {
    const bounds = timerSyncedBounds(10_000, [3.2, 3.5, 3.1]);
    expect(bounds.startMs).toBe(10_000 - DEFAULT_PRE_ROLL_MS);
    expect(bounds.endMs).toBe(10_000 + 3.5 * 1000 + DEFAULT_POST_ROLL_MS);
    expect(bounds.t0OffsetMs).toBe(DEFAULT_PRE_ROLL_MS);
  });

  it('uses only the slowest lane, not the sum or the fastest', () => {
    const bounds = timerSyncedBounds(0, [2.0, 9.0, 5.5]);
    expect(bounds.endMs).toBe(9.0 * 1000 + DEFAULT_POST_ROLL_MS);
  });

  it('still produces a clip when every lane is a DNF (empty input)', () => {
    const bounds = timerSyncedBounds(10_000, []);
    expect(bounds.startMs).toBe(10_000 - DEFAULT_PRE_ROLL_MS);
    expect(bounds.endMs).toBe(10_000 + DEFAULT_POST_ROLL_MS);
  });

  it('honours custom pre/post roll', () => {
    const bounds = timerSyncedBounds(10_000, [4.0], 2000, 500);
    expect(bounds.startMs).toBe(8000);
    expect(bounds.endMs).toBe(14_500);
    expect(bounds.t0OffsetMs).toBe(2000);
  });
});

describe('noneFallbackBounds', () => {
  it('skips back a fixed amount before the result landed', () => {
    const bounds = noneFallbackBounds(20_000);
    expect(bounds.startMs).toBe(20_000 - NONE_FALLBACK_SKIPBACK_MS);
    expect(bounds.endMs).toBe(20_000 + DEFAULT_POST_ROLL_MS);
    expect(bounds.t0OffsetMs).toBe(NONE_FALLBACK_SKIPBACK_MS);
  });

  it('honours a custom skipback and post-roll', () => {
    const bounds = noneFallbackBounds(20_000, 3000, 800);
    expect(bounds.startMs).toBe(17_000);
    expect(bounds.endMs).toBe(20_800);
    expect(bounds.t0OffsetMs).toBe(3000);
  });
});
