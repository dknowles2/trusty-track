import { describe, expect, it } from 'vitest';
import {
  LAST_N_HEATS,
  highlightCaption,
  highlightOrder,
  highlightReel,
  highlightRoundId,
  type HighlightHeat,
} from './highlights';

const clip = (cameraId = 'cam-1') => ({
  cameraId,
  url: `/replay/${cameraId}.webm`,
  durationMs: 4000,
  t0OffsetMs: 500,
});

function heat(overrides: Partial<HighlightHeat> & { heatId: number }): HighlightHeat {
  return {
    heatNumber: overrides.heatId,
    roundId: 1,
    roundNumber: 1,
    recordedAt: null,
    lanes: [],
    replays: [],
    ...overrides,
  };
}

describe('highlightOrder', () => {
  it('drops heats with no stored clip', () => {
    const heats = [
      heat({ heatId: 1, lanes: [{ place: 1, time: 3.5, racerId: 10 }], replays: [] }),
      heat({ heatId: 2, lanes: [{ place: 1, time: 3.0, racerId: 11 }], replays: [clip()] }),
    ];
    const order = highlightOrder(heats);
    expect(order.map((c) => c.heatId)).toEqual([2]);
  });

  it('orders fastest winning time first', () => {
    const heats = [
      heat({ heatId: 1, lanes: [{ place: 1, time: 3.5, racerId: 10 }], replays: [clip()] }),
      heat({ heatId: 2, lanes: [{ place: 1, time: 3.0, racerId: 11 }], replays: [clip()] }),
      heat({ heatId: 3, lanes: [{ place: 1, time: 3.2, racerId: 12 }], replays: [clip()] }),
    ];
    const order = highlightOrder(heats);
    expect(order.map((c) => c.heatId)).toEqual([2, 3, 1]);
    expect(order[0].winnerTime).toBe(3.0);
    expect(order[0].winnerRacerId).toBe(11);
  });

  it('sorts a heat with no timed winner last, by heat number', () => {
    // A hand-entered POINTS heat: a place with no time.
    const heats = [
      heat({ heatId: 1, lanes: [{ place: 1, time: 3.5, racerId: 10 }], replays: [clip()] }),
      heat({ heatId: 2, lanes: [{ place: 1, time: null, racerId: 11 }], replays: [clip()] }),
      heat({ heatId: 3, lanes: [{ place: 1, time: null, racerId: 12 }], replays: [clip()] }),
    ];
    const order = highlightOrder(heats);
    expect(order.map((c) => c.heatId)).toEqual([1, 2, 3]);
    expect(order[1].winnerTime).toBeNull();
  });

  it('breaks a tie on winning time by heat number', () => {
    const heats = [
      heat({ heatId: 5, lanes: [{ place: 1, time: 3.0, racerId: 10 }], replays: [clip()] }),
      heat({ heatId: 2, lanes: [{ place: 1, time: 3.0, racerId: 11 }], replays: [clip()] }),
    ];
    const order = highlightOrder(heats);
    expect(order.map((c) => c.heatId)).toEqual([2, 5]);
  });

  it('picks the first clip in the operator\'s own camera order (#177 stage 4) — the array order the server already sorted, not a second alphabetical rule here', () => {
    const heats = [
      heat({
        heatId: 1,
        lanes: [{ place: 1, time: 3.0, racerId: 10 }],
        // Deliberately *not* alphabetical — `replays` arrives pre-sorted
        // by `Display.cameraOrder` (`_order_replay_clips`), and `cam-b`
        // sorting first here is exactly what proves `firstClip` no longer
        // re-sorts it by `cameraId` itself.
        replays: [clip('cam-b'), clip('cam-a')],
      }),
    ];
    const order = highlightOrder(heats);
    expect(order[0].clip.cameraId).toBe('cam-b');
  });

  it('bounds to the most recent LAST_N_HEATS by heat number when the round holds more', () => {
    const heats = Array.from({ length: LAST_N_HEATS + 3 }, (_, i) =>
      heat({
        heatId: i + 1,
        heatNumber: i + 1,
        lanes: [{ place: 1, time: 5 - i * 0.01, racerId: i }],
        replays: [clip()],
      }),
    );
    const order = highlightOrder(heats);
    expect(order).toHaveLength(LAST_N_HEATS);
    // The three earliest heats (lowest heat numbers) are dropped.
    const includedHeatNumbers = order.map((c) => c.heatNumber).sort((a, b) => a - b);
    expect(includedHeatNumbers[0]).toBe(4);
  });

  it('returns an empty list when no heat has a clip', () => {
    const heats = [heat({ heatId: 1 })];
    expect(highlightOrder(heats)).toEqual([]);
  });
});

describe('highlightRoundId', () => {
  it('is null when nothing has a clip', () => {
    expect(highlightRoundId([heat({ heatId: 1 })])).toBeNull();
  });

  it('picks the round of the most recently recorded heat', () => {
    const heats = [
      heat({ heatId: 1, roundId: 1, roundNumber: 1, recordedAt: '2026-01-01T00:00:00Z', replays: [clip()] }),
      heat({ heatId: 2, roundId: 2, roundNumber: 2, recordedAt: '2026-01-01T00:05:00Z', replays: [clip()] }),
    ];
    expect(highlightRoundId(heats)).toBe(2);
  });

  it('falls back to the latest round with a clip when nothing is recorded yet', () => {
    const heats = [
      heat({ heatId: 1, roundId: 1, roundNumber: 1, recordedAt: null, replays: [clip()] }),
      heat({ heatId: 2, roundId: 2, roundNumber: 2, recordedAt: null, replays: [] }),
    ];
    expect(highlightRoundId(heats)).toBe(1);
  });
});

describe('highlightReel', () => {
  it('filters to the picked round only', () => {
    const heats = [
      heat({
        heatId: 1,
        roundId: 1,
        roundNumber: 1,
        recordedAt: '2026-01-01T00:00:00Z',
        lanes: [{ place: 1, time: 3.0, racerId: 1 }],
        replays: [clip()],
      }),
      heat({
        heatId: 2,
        roundId: 2,
        roundNumber: 2,
        recordedAt: null,
        lanes: [{ place: 1, time: 2.0, racerId: 2 }],
        replays: [clip()],
      }),
    ];
    const reel = highlightReel(heats);
    expect(reel.map((c) => c.heatId)).toEqual([1]);
  });
});

describe('highlightCaption', () => {
  it('joins heat number, name and time', () => {
    expect(highlightCaption(7, 'Dash Tire', 3.148)).toBe('Heat 7 · Dash Tire · 3.148 s');
  });

  it('omits a missing name', () => {
    expect(highlightCaption(7, null, 3.148)).toBe('Heat 7 · 3.148 s');
  });

  it('omits a missing time', () => {
    expect(highlightCaption(7, 'Dash Tire', null)).toBe('Heat 7 · Dash Tire');
  });
});
