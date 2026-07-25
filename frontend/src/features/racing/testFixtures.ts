/**
 * Heat fixtures for the race-control tests.
 *
 * A heat now reports its lanes twice — structurally as `lanes`, and as the
 * `laneResults` JSON string the write path still uses. The server derives one
 * from the other, so a fixture that sets only one of them describes a heat the
 * server could never send, and a test built on it can pass while the screen is
 * broken.
 *
 * Build fixtures here instead, from the lanes alone.
 */
import type { Heat, Lane } from './types';

export const lane = (over: Partial<Lane> & { lane: number }): Lane => ({
  racerId: null,
  placeholderSlot: null,
  time: null,
  place: null,
  skipped: false,
  ...over,
});

/** The blob the server would hold for these lanes. */
export const laneResultsFor = (lanes: readonly Lane[]): string =>
  JSON.stringify(
    lanes.map((l) => ({
      lane: l.lane,
      // The encoding `lanes` exists to replace: an undecided championship slot
      // was stored as a negative racer id.
      racer_id: l.placeholderSlot !== null ? -l.placeholderSlot : l.racerId,
      time: l.time,
      place: l.place,
      ...(l.skipped ? { skipped: true } : {}),
    })),
  );

export const heat = (
  over: Partial<Omit<Heat, 'lanes' | 'laneResults'>> & { lanes?: Lane[] } = {},
): Heat => {
  const { lanes = [], ...rest } = over;
  return {
    id: 1,
    heatNumber: 1,
    roundNumber: 1,
    roundId: 1,
    roundName: 'Round 1',
    lanes,
    laneResults: laneResultsFor(lanes),
    ...rest,
  };
};
