import { describe, it, expect } from 'vitest';
import { hasTimes, hasRun, wasSkipped, byPlace } from './lanes';
import { lane } from './testFixtures';

/**
 * Issue #5. These predicates were eight inline copies of the same test before
 * they were named, and they had drifted — some counted a skipped heat as run
 * and some did not. The difference is deliberate now, so it needs pinning.
 */
describe('lane predicates', () => {
  const unrun = [lane({ lane: 1, racerId: 1 }), lane({ lane: 2, racerId: 2 })];
  const timed = [lane({ lane: 1, racerId: 1, time: 3.4, place: 1 })];
  const skipped = [lane({ lane: 1, racerId: 1, skipped: true })];

  it('an unraced heat has neither times nor a run', () => {
    expect(hasTimes(unrun)).toBe(false);
    expect(hasRun(unrun)).toBe(false);
    expect(wasSkipped(unrun)).toBe(false);
  });

  it('a timed heat has both', () => {
    expect(hasTimes(timed)).toBe(true);
    expect(hasRun(timed)).toBe(true);
  });

  it('a skipped heat counts as run but has no times', () => {
    // The distinction the inline copies kept getting wrong: "is this heat
    // finished" and "does this heat have results" are different questions.
    expect(hasRun(skipped)).toBe(true);
    expect(hasTimes(skipped)).toBe(false);
    expect(wasSkipped(skipped)).toBe(true);
  });

  it('a heat that was skipped and then run is not skipped any more', () => {
    const rerun = [lane({ lane: 1, racerId: 1, time: 3.4, skipped: true })];
    expect(wasSkipped(rerun)).toBe(false);
  });

  it('an empty heat has not run', () => {
    expect(hasRun([])).toBe(false);
    expect(hasTimes([])).toBe(false);
    expect(wasSkipped([])).toBe(false);
  });

  it('a zero time is a time', () => {
    // 0.0 is how a DNF reaches the database; it is a recorded result, and
    // treating it as absent would make a raced heat look unraced.
    expect(hasTimes([lane({ lane: 1, racerId: 1, time: 0 })])).toBe(true);
  });

  it('orders by place, unplaced last', () => {
    const lanes = [
      lane({ lane: 1, place: null }),
      lane({ lane: 2, place: 2 }),
      lane({ lane: 3, place: 1 }),
    ];
    expect(byPlace(lanes).map((l) => l.lane)).toEqual([3, 2, 1]);
  });

  it('does not reorder in place', () => {
    const lanes = [lane({ lane: 1, place: 2 }), lane({ lane: 2, place: 1 })];
    byPlace(lanes);
    expect(lanes.map((l) => l.lane)).toEqual([1, 2]);
  });
});
