/**
 * Heat fixtures for the race-control tests.
 *
 * Small, but worth having in one place: `Lane` gained fields as #5 progressed,
 * and a fixture that spells out an object literal per test goes stale silently
 * — TypeScript only complains about the ones it can see.
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

export const heat = (
  over: Partial<Omit<Heat, 'lanes'>> & { lanes?: Lane[] } = {},
): Heat => {
  const { lanes = [], ...rest } = over;
  return {
    id: 1,
    heatNumber: 1,
    roundNumber: 1,
    roundId: 1,
    roundName: 'Round 1',
    lanes,
    ...rest,
  };
};
