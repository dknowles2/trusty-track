import { describe, it, expect } from 'vitest';
import { hasTimes, hasRun, wasSkipped, byPlace, assignPlaces, shouldDerivePlaces, shouldDerivePlacesForFreeRace, toInput } from './lanes';
import { lane } from './testFixtures';
import type { LaneInput } from './types';

const input = (over: Parameters<typeof lane>[0]): LaneInput => toInput(lane(over));

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

  it('a hand-entered place with no time counts as run (#490)', () => {
    // A `POINTS` race entered by hand — no timer, or a timer that only
    // reports finishing order — writes a place with no time at all. Before
    // #490 nothing ever did, so `hasTime`/`hasRun` only asked about `time`;
    // broadened to match `Lane.has_result` in `backend/domain/lanes.py`.
    const placedOnly = [lane({ lane: 1, racerId: 1, time: null, place: 1 })];
    expect(hasTimes(placedOnly)).toBe(true);
    expect(hasRun(placedOnly)).toBe(true);
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

/**
 * Issue #308. A recorded 0.0 is a DNF (backend/domain/scoring.py's rule: a
 * time <= 0 gets no place), but the editor's ascending sort ranked it first —
 * a routine hand-correction that touched no other lane handed the car that
 * never crossed the sensor first place.
 */
describe('assignPlaces', () => {
  it('ranks a normal heat by ascending time', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 5.2 }),
      input({ lane: 2, racerId: 2, time: 3.1 }),
      input({ lane: 3, racerId: 3, time: 4.0 }),
    ];
    const placed = assignPlaces(results);
    expect(placed.find((r) => r.lane === 2)?.place).toBe(1);
    expect(placed.find((r) => r.lane === 3)?.place).toBe(2);
    expect(placed.find((r) => r.lane === 1)?.place).toBe(3);
  });

  it('a recorded 0.0 (a DNF) gets no place, and does not steal first', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 0 }),
      input({ lane: 2, racerId: 2, time: 4.821 }),
      input({ lane: 3, racerId: 3, time: 5.0 }),
    ];
    const placed = assignPlaces(results);
    expect(placed.find((r) => r.lane === 1)?.place).toBeNull();
    expect(placed.find((r) => r.lane === 2)?.place).toBe(1);
    expect(placed.find((r) => r.lane === 3)?.place).toBe(2);
  });

  it('a negative time also gets no place', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: -1 }),
      input({ lane: 2, racerId: 2, time: 4.0 }),
    ];
    const placed = assignPlaces(results);
    expect(placed.find((r) => r.lane === 1)?.place).toBeNull();
    expect(placed.find((r) => r.lane === 2)?.place).toBe(1);
  });

  it('an unrun lane (null time) gets no place', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 3.0 }),
      input({ lane: 2, racerId: 2, time: null }),
    ];
    const placed = assignPlaces(results);
    expect(placed.find((r) => r.lane === 1)?.place).toBe(1);
    expect(placed.find((r) => r.lane === 2)?.place).toBeNull();
  });

  it('clears skipped once any lane has a time', () => {
    const results = [input({ lane: 1, racerId: 1, time: 3.0, skipped: true })];
    expect(assignPlaces(results)[0].skipped).toBe(false);
  });

  it('a heat with no recorded times at all clears every place', () => {
    const results = [
      input({ lane: 1, racerId: 1, skipped: true }),
      input({ lane: 2, racerId: 2, skipped: true }),
    ];
    const placed = assignPlaces(results);
    expect(placed.every((r) => r.place === null)).toBe(true);
    // Skip is the caller's own decision here, not this function's to touch.
    expect(placed.every((r) => r.skipped === true)).toBe(true);
  });

  it('a heat that is entirely DNFs places nobody', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 0 }),
      input({ lane: 2, racerId: 2, time: 0 }),
    ];
    const placed = assignPlaces(results);
    expect(placed.every((r) => r.place === null)).toBe(true);
  });

  it('does not mutate its input', () => {
    const results = [input({ lane: 1, racerId: 1, time: 3.0 })];
    assignPlaces(results);
    expect(results[0].place).toBeNull();
  });
});

/**
 * Issue #490. `handleUpdateResult` in `RaceControl.tsx` calls `assignPlaces`
 * only when `shouldDerivePlaces` says so — always for `TIMED`, since that is
 * the only strategy the Edit/Override modal shows a time column for; never
 * for `POINTS`, which shows a place column instead and has no time to derive
 * anything from.
 */
describe('shouldDerivePlaces', () => {
  it('derives places from times for a TIMED race', () => {
    expect(shouldDerivePlaces('TIMED')).toBe(true);
  });

  it('leaves hand-entered places alone for a POINTS race', () => {
    expect(shouldDerivePlaces('POINTS')).toBe(false);
  });

  it('defaults to deriving when the strategy is not known yet', () => {
    expect(shouldDerivePlaces(null)).toBe(true);
    expect(shouldDerivePlaces(undefined)).toBe(true);
  });
});

describe('assignPlaces and shouldDerivePlaces together (#490)', () => {
  it('a hand-typed time under TIMED gets turned into a place', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 4.821 }),
      input({ lane: 2, racerId: 2, time: 3.5 }),
    ];
    const saved = shouldDerivePlaces('TIMED') ? assignPlaces(results) : results;
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
    expect(saved.find((r) => r.lane === 1)?.place).toBe(2);
  });

  it('a DNF (0.0) under TIMED gets no place', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 0 }),
      input({ lane: 2, racerId: 2, time: 3.5 }),
    ];
    const saved = shouldDerivePlaces('TIMED') ? assignPlaces(results) : results;
    expect(saved.find((r) => r.lane === 1)?.place).toBeNull();
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
  });

  it('a hand-typed place under POINTS is sent exactly as entered', () => {
    // The bug #490 fixes: calling assignPlaces unconditionally here would
    // read "no time anywhere" as "clear every place" and silently discard
    // the finishing order the operator just typed in.
    const results = [
      input({ lane: 1, racerId: 1, time: null, place: 2 }),
      input({ lane: 2, racerId: 2, time: null, place: 1 }),
    ];
    const saved = shouldDerivePlaces('POINTS') ? assignPlaces(results) : results;
    expect(saved.find((r) => r.lane === 1)?.place).toBe(2);
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
  });

  it('correcting a mistyped time under TIMED still recomputes every place', () => {
    // The reason the rule is keyed on strategy, not on "times present and
    // places absent" in the edited payload: the *old* places are still
    // sitting right there when the operator is only fixing one time.
    const results = [
      input({ lane: 1, racerId: 1, time: 3.2, place: 1 }),
      input({ lane: 2, racerId: 2, time: 4.5, place: 2 }),
    ];
    // Lane 1's corrected time is now the slower one.
    const corrected = results.map((r) => (r.lane === 1 ? { ...r, time: 5.0 } : r));
    const saved = shouldDerivePlaces('TIMED') ? assignPlaces(corrected) : corrected;
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
    expect(saved.find((r) => r.lane === 1)?.place).toBe(2);
  });

  /**
   * #525: the Edit/Override modal now shows a Time column for a POINTS race
   * too, so a stored or spurious time can be corrected without going through
   * the Place column. This is the "both columns" case the issue's suggested
   * fix names — `shouldDerivePlaces` must still say `false` for `POINTS`,
   * or a hand-typed finishing order sent alongside a present time would be
   * overwritten by `assignPlaces` deriving places from that time instead.
   */
  it('a hand-typed place under POINTS survives even when a time is present (#525)', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 3.5, place: 2 }),
      input({ lane: 2, racerId: 2, time: 3.6, place: 1 }),
    ];
    const saved = shouldDerivePlaces('POINTS') ? assignPlaces(results) : results;
    // Unchanged: the hand-typed places, not what assignPlaces would derive
    // from the times (which would rank lane 1 first, not lane 2).
    expect(saved.find((r) => r.lane === 1)?.place).toBe(2);
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
    expect(saved.find((r) => r.lane === 1)?.time).toBe(3.5);
  });

  it('clearing a POINTS heat\'s time to correct a spurious record leaves the place alone (#525)', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: null, place: 3 }),
      input({ lane: 2, racerId: 2, time: 0.412, place: 1 }), // a spurious sensor misfire
    ];
    // The operator clears lane 2's stored time to correct it.
    const corrected = results.map((r) => (r.lane === 2 ? { ...r, time: null } : r));
    const saved = shouldDerivePlaces('POINTS') ? assignPlaces(corrected) : corrected;
    expect(saved.find((r) => r.lane === 2)?.time).toBeNull();
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
  });
});

/**
 * Issue #526. `FreeRaceExecution` keys the same gate off the *track* having
 * a timer rather than the race's scoring strategy — a free heat is never
 * scored under either strategy, so `shouldDerivePlaces` is the wrong
 * question there.
 */
describe('shouldDerivePlacesForFreeRace', () => {
  it('derives places from times on a track with a timer', () => {
    expect(shouldDerivePlacesForFreeRace(true)).toBe(true);
  });

  it('leaves a hand-typed place alone on a track with no timer', () => {
    expect(shouldDerivePlacesForFreeRace(false)).toBe(false);
  });

  it('a hand-typed place on a no-timer track is sent exactly as entered', () => {
    // The bug #526 fixes: calling assignPlaces unconditionally here would
    // read "no time anywhere" as "clear every place" and silently discard
    // the finishing order the operator just typed in — free racing has no
    // scoring strategy to key off, so this has to be tested on its own.
    const results = [
      input({ lane: 1, racerId: 1, time: null, place: 2 }),
      input({ lane: 2, racerId: 2, time: null, place: 1 }),
    ];
    const saved = shouldDerivePlacesForFreeRace(false) ? assignPlaces(results) : results;
    expect(saved.find((r) => r.lane === 1)?.place).toBe(2);
    expect(saved.find((r) => r.lane === 2)?.place).toBe(1);
  });
});
