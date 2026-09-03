import { describe, test, expect } from 'vitest';
import {
  liveRemainingSeconds,
  isLiveActive,
  formatCountdown,
  NONE,
  INTERMISSION_PRESETS,
  EXTEND_SECONDS,
  type IntermissionData,
} from './intermission';

const NOW = new Date('2026-09-02T12:00:00.000Z');

const running = (remainingSeconds: number, overrides: Partial<IntermissionData> = {}): IntermissionData => ({
  active: true,
  remainingSeconds,
  paused: false,
  label: 'Snack break',
  endsAt: new Date(NOW.getTime() + remainingSeconds * 1000).toISOString(),
  ...overrides,
});

describe('liveRemainingSeconds', () => {
  test('measures a running countdown against the caller clock, not the snapshot', () => {
    // The snapshot is stale — as if the payload arrived 100s ago — and the
    // live answer is derived from `endsAt`, which does not go stale.
    const stale = running(300);
    const later = new Date(NOW.getTime() + 100_000);
    expect(liveRemainingSeconds(stale, later)).toBe(200);
  });

  test('never goes negative once the deadline has passed', () => {
    const state = running(60);
    const wayLater = new Date(NOW.getTime() + 120_000);
    expect(liveRemainingSeconds(state, wayLater)).toBe(0);
  });

  test('a paused intermission reads the stored number, not the clock', () => {
    const paused: IntermissionData = {
      active: true,
      remainingSeconds: 42,
      paused: true,
      label: null,
      endsAt: null,
    };
    const muchLater = new Date(NOW.getTime() + 3_600_000);
    expect(liveRemainingSeconds(paused, NOW)).toBe(42);
    expect(liveRemainingSeconds(paused, muchLater)).toBe(42);
  });

  test('no intermission is zero', () => {
    expect(liveRemainingSeconds(NONE, NOW)).toBe(0);
  });
});

describe('isLiveActive', () => {
  test('true while the countdown still has time left', () => {
    expect(isLiveActive(running(30), NOW)).toBe(true);
  });

  test('false once the live countdown reaches zero, even if the snapshot still says active', () => {
    // No new event has arrived to say the break ended — the display still
    // holds a payload with `active: true` from a few minutes ago — but the
    // countdown itself has run out, and the overlay must not linger.
    const stale = running(60);
    const afterDeadline = new Date(NOW.getTime() + 90_000);
    expect(isLiveActive(stale, afterDeadline)).toBe(false);
  });

  test('a paused intermission with time left stays active', () => {
    const paused: IntermissionData = {
      active: true,
      remainingSeconds: 90,
      paused: true,
      label: null,
      endsAt: null,
    };
    expect(isLiveActive(paused, NOW)).toBe(true);
  });

  test('NONE is never active', () => {
    expect(isLiveActive(NONE, NOW)).toBe(false);
  });
});

describe('formatCountdown', () => {
  test.each([
    [0, '0:00'],
    [5, '0:05'],
    [59, '0:59'],
    [60, '1:00'],
    [272, '4:32'],
    [3600, '60:00'],
  ])('%i seconds formats as %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected);
  });

  test('never renders negative', () => {
    expect(formatCountdown(-5)).toBe('0:00');
  });

  test('a fractional second is floored, not rounded up past the whole second', () => {
    expect(formatCountdown(59.9)).toBe('0:59');
  });
});

describe('the shared preset list', () => {
  test('offers 5, 10 and 15 minutes', () => {
    expect(INTERMISSION_PRESETS.map((p) => p.seconds)).toEqual([300, 600, 900]);
  });
});

describe('EXTEND_SECONDS', () => {
  test('is five minutes', () => {
    expect(EXTEND_SECONDS).toBe(300);
  });
});
