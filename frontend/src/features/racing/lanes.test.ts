import { describe, it, expect } from 'vitest';
import {
  hasTimes,
  hasRun,
  wasSkipped,
  skippedHeats,
  byPlace,
  assignPlaces,
  formatLaneTime,
  isLaneEmpty,
  isTimeBasedStrategy,
  shouldDerivePlaces,
  shouldDerivePlacesForFreeRace,
  toInput,
  placeIssue,
  duplicatePlaces,
  placesAboveField,
  placesBelowOne,
  parseTimeText,
  tiedTimeGroups,
  laneColumnCount,
} from './lanes';
import { lane, heat } from './testFixtures';
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
 * Issue #1014. `racerId === null` covers two different lanes — an undecided
 * championship slot and one nobody is coming to fill — and only the second
 * is empty. Mirrors `Lane.is_empty` in `backend/domain/lanes.py`, which asks
 * about both fields for the same reason.
 */
describe('isLaneEmpty', () => {
  it('a racer is not empty', () => {
    expect(isLaneEmpty(lane({ lane: 1, racerId: 7 }))).toBe(false);
  });

  it('an undecided placeholder slot is not empty', () => {
    expect(isLaneEmpty(lane({ lane: 1, racerId: null, placeholderSlot: 2 }))).toBe(false);
  });

  it('a lane with neither a racer nor a placeholder is empty', () => {
    expect(isLaneEmpty(lane({ lane: 1, racerId: null, placeholderSlot: null }))).toBe(true);
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

  it('assigns shared places and skips ranks for tied times (1, 1, 3 and 1, 2, 2, 4) (#816)', () => {
    const twoWayFirst = [
      input({ lane: 1, racerId: 1, time: 3.1 }),
      input({ lane: 2, racerId: 2, time: 3.1 }),
      input({ lane: 3, racerId: 3, time: 3.2 }),
    ];
    const placedFirst = assignPlaces(twoWayFirst);
    expect(placedFirst.find((r) => r.lane === 1)?.place).toBe(1);
    expect(placedFirst.find((r) => r.lane === 2)?.place).toBe(1);
    expect(placedFirst.find((r) => r.lane === 3)?.place).toBe(3);

    const twoWaySecond = [
      input({ lane: 1, racerId: 1, time: 3.1 }),
      input({ lane: 2, racerId: 2, time: 3.2 }),
      input({ lane: 3, racerId: 3, time: 3.2 }),
      input({ lane: 4, racerId: 4, time: 3.3 }),
    ];
    const placedSecond = assignPlaces(twoWaySecond);
    expect(placedSecond.find((r) => r.lane === 1)?.place).toBe(1);
    expect(placedSecond.find((r) => r.lane === 2)?.place).toBe(2);
    expect(placedSecond.find((r) => r.lane === 3)?.place).toBe(2);
    expect(placedSecond.find((r) => r.lane === 4)?.place).toBe(4);
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

/**
 * #547 stage 1. `isTimeBasedStrategy` is what `shouldDerivePlaces` and
 * `RaceExecution`'s modal column choice are restated through, so a new
 * scoring strategy answers this question once rather than being checked at
 * every call site that used to spell out `=== 'TIMED'` or `!== 'POINTS'` by
 * hand. Both new strategies are time-based — neither sums hand-entered
 * places the way `POINTS` does — so they belong on the `true` side, same as
 * `TIMED`.
 */
describe('isTimeBasedStrategy', () => {
  it('is true for TIMED', () => {
    expect(isTimeBasedStrategy('TIMED')).toBe(true);
  });

  it('is false for POINTS, the one place-based strategy', () => {
    expect(isTimeBasedStrategy('POINTS')).toBe(false);
  });

  it('is true for CUMULATIVE_TIME', () => {
    expect(isTimeBasedStrategy('CUMULATIVE_TIME')).toBe(true);
  });

  it('is true for FASTEST_TIME', () => {
    expect(isTimeBasedStrategy('FASTEST_TIME')).toBe(true);
  });

  it('defaults to time-based when the strategy is not known yet', () => {
    expect(isTimeBasedStrategy(null)).toBe(true);
    expect(isTimeBasedStrategy(undefined)).toBe(true);
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

/**
 * Issue #766. Hand-entered places got no client-side check before Save,
 * whose only backstop was the server's `validate_lane_replacement` — a
 * round trip and a refusal the operator had to interpret before they even
 * found out something was wrong. These mirror that function's own rules
 * (`backend/domain/lanes.py`'s `places_below_one`, `places_above_field`,
 * `duplicate_places`) so the same input is refused in the same words on
 * both sides — the client is a first check, not a replacement one.
 */
describe('placesBelowOne', () => {
  it('names a lane whose place is not a positive number', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 0 }),
      input({ lane: 2, racerId: 2, place: 1 }),
    ];
    expect(placesBelowOne(results)).toEqual([1]);
  });

  it('says nothing about a lane with no place at all', () => {
    const results = [input({ lane: 1, racerId: 1, place: null })];
    expect(placesBelowOne(results)).toEqual([]);
  });
});

describe('placesAboveField', () => {
  it('names a lane placed beyond the number of real racers in the heat', () => {
    // Two real racers in this heat — a place of 3 has nobody to be third
    // behind.
    const results = [
      input({ lane: 1, racerId: 1, place: 3 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(placesAboveField(results)).toEqual([1]);
  });

  it('says nothing when nobody has been given a place at all — no field to bound against', () => {
    const results = [
      input({ lane: 1, racerId: null, place: null }),
      input({ lane: 2, racerId: null, place: null }),
    ];
    expect(placesAboveField(results)).toEqual([]);
  });

  it('counts only real racers toward the field, not empty or placeholder lanes', () => {
    const results = [
      // Placed 2nd, but the only other lane in the heat is empty — one real
      // racer in the field, so nobody can be 2nd behind them.
      input({ lane: 1, racerId: 1, place: 2 }),
      input({ lane: 2, racerId: null, place: null }),
    ];
    expect(placesAboveField(results)).toEqual([1]);
  });
});

describe('duplicatePlaces', () => {
  it('names a place claimed by more than one lane', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 2 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(duplicatePlaces(results)).toEqual([2]);
  });

  it('says nothing when every place is distinct', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 1 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(duplicatePlaces(results)).toEqual([]);
  });

  it('two unplaced lanes are not a duplicate of each other', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: null }),
      input({ lane: 2, racerId: 2, place: null }),
    ];
    expect(duplicatePlaces(results)).toEqual([]);
  });

  it('allows duplicate places when lanes have identical positive times (#816)', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 3.5, place: 1 }),
      input({ lane: 2, racerId: 2, time: 3.5, place: 1 }),
      input({ lane: 3, racerId: 3, time: 3.6, place: 3 }),
    ];
    expect(duplicatePlaces(results)).toEqual([]);
  });

  it('refuses duplicate places when lanes have differing times (#816)', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 3.5, place: 1 }),
      input({ lane: 2, racerId: 2, time: 3.6, place: 1 }),
    ];
    expect(duplicatePlaces(results)).toEqual([1]);
  });
});

describe('placeIssue', () => {
  it('is silent when every place is valid', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 1 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(placeIssue(results)).toBeNull();
  });

  it('allows tied places when times match genuinely (#816)', () => {
    const results = [
      input({ lane: 1, racerId: 1, time: 3.5, place: 1 }),
      input({ lane: 2, racerId: 2, time: 3.5, place: 1 }),
      input({ lane: 3, racerId: 3, time: 3.6, place: 3 }),
    ];
    expect(placeIssue(results)).toBeNull();
  });


  it('reports the first duplicate place — the exact sentence a client following the server backstop would show', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 2 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(placeIssue(results)).toBe('Place 2 is assigned to more than one lane.');
  });

  it('reports a place higher than the field before checking for duplicates', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 5 }),
      input({ lane: 2, racerId: 2, place: 2 }),
    ];
    expect(placeIssue(results)).toBe(
      "Lane 1's place is higher than the 2 racer(s) in this heat.",
    );
  });

  it('reports a non-positive place ahead of everything else', () => {
    const results = [
      input({ lane: 1, racerId: 1, place: 0 }),
      input({ lane: 2, racerId: 2, place: 0 }),
    ];
    expect(placeIssue(results)).toBe("Lane 1's place must be 1 or higher.");
  });
});

/**
 * `parseTimeText` factors out the parsing `handleSaveResults` already did
 * inline, so the tie-detector below reads the same value that actually gets
 * saved rather than a second, possibly-drifted copy of the same rule.
 */
describe('parseTimeText', () => {
  it('parses a typed number', () => {
    expect(parseTimeText('3.501')).toBe(3.501);
  });

  it('treats a blank field as no time, not zero', () => {
    expect(parseTimeText('')).toBeNull();
    expect(parseTimeText('   ')).toBeNull();
  });

  it('treats unparsable text as no time', () => {
    expect(parseTimeText('abc')).toBeNull();
  });
});

/**
 * Issue #766's second half: `assignPlaces` breaks a genuine tie in recorded
 * times by array order with nothing on screen to say a tie happened — two
 * identical hand-typed times silently become 2nd and 3rd. This does not
 * change what gets saved (see `lanes.ts`'s note on why not); it is what lets
 * `RaceExecution` show the operator the tie exists.
 */
describe('tiedTimeGroups', () => {
  it('groups lanes that recorded the identical time', () => {
    const rows = [
      { lane: 1, time: 3.5 },
      { lane: 2, time: 3.5 },
      { lane: 3, time: 3.6 },
    ];
    expect(tiedTimeGroups(rows)).toEqual([{ time: 3.5, lanes: [1, 2] }]);
  });

  it('says nothing when every time is distinct', () => {
    const rows = [
      { lane: 1, time: 3.5 },
      { lane: 2, time: 3.6 },
    ];
    expect(tiedTimeGroups(rows)).toEqual([]);
  });

  it('ignores lanes with no time or a DNF (#308\'s zero-or-less rule)', () => {
    const rows = [
      { lane: 1, time: null },
      { lane: 2, time: 0 },
      { lane: 3, time: -1 },
    ];
    expect(tiedTimeGroups(rows)).toEqual([]);
  });
});

/**
 * Issue #763. A per-lane time used to be `.toFixed()`-ed inline at whichever
 * precision the screen it lived on happened to pick — three decimals on
 * most, four on RaceExecution/ScheduleManagement/FreeRaceExecution/
 * RaceControl's live-heat views — and none of them said "DNF" for a
 * non-positive time, which is the marker `assignPlaces` above already
 * treats specially. This is the one place both rules live now.
 */
describe('formatLaneTime', () => {
  it('formats a real time to three decimals, regardless of how many the raw float carries', () => {
    // What the fake timer used to hand back before #763's other fix, and
    // what a real device's own value looks like once parsed to a float.
    expect(formatLaneTime(3.41412257608823)).toBe('3.414s');
    expect(formatLaneTime(3.4)).toBe('3.400s');
  });

  it('returns null for nothing recorded, leaving the fallback to the caller', () => {
    expect(formatLaneTime(null)).toBeNull();
    expect(formatLaneTime(undefined)).toBeNull();
  });

  it('labels a zero time DNF rather than printing "0.000s"', () => {
    expect(formatLaneTime(0)).toBe('DNF');
  });

  it('labels a negative time DNF too', () => {
    expect(formatLaneTime(-1)).toBe('DNF');
  });

  it('does not relabel an ordinary slow-but-real time that happens to be 9.999s', () => {
    // 9.999 is `domain/scoring.py`'s DNF *penalty* substituted only when
    // averaging a score — never a value this app writes to a stored lane —
    // so a genuinely slow car's raw recorded time is not this rule's
    // concern. `scoringStrategyText.formatScore`'s own test pins the
    // aggregate-score half of this label.
    expect(formatLaneTime(9.999)).toBe('9.999s');
  });
});

/**
 * Issue #994. A track is shared across seasons, and shrinking it after a
 * race finished must not clip that race's own results off the Schedule tab
 * or the printed heat sheet — the fix both screens share.
 */
describe('laneColumnCount', () => {
  it('is just the track lane count when no heat holds a higher lane', () => {
    const heats = [
      heat({ lanes: [lane({ lane: 1 }), lane({ lane: 2 })] }),
      heat({ lanes: [lane({ lane: 1 }), lane({ lane: 2 })] }),
    ];
    expect(laneColumnCount(3, heats)).toBe(3);
  });

  it('widens to a heat holding a lane past a since-shrunk track', () => {
    // A race finished on a 3-lane track, every heat recorded in lane 3, and
    // the track was later reconfigured down to 2. The stored heat still
    // names lane 3 (#325 only rewrites *pending* heats), so the column
    // count has to follow the data rather than the track's current value.
    const heats = [heat({ lanes: [lane({ lane: 1 }), lane({ lane: 2 }), lane({ lane: 3, time: 3.5 })] })];
    expect(laneColumnCount(2, heats)).toBe(3);
  });

  it('is unaffected by a heat short a lane — the outage case this extends', () => {
    // A lane out of service leaves a heat with fewer lane rows than the
    // track has, and the existing rule (a column for every lane the track
    // has) must still hold: nothing here should shrink the count below
    // `laneCount`.
    const heats = [heat({ lanes: [lane({ lane: 1 }), lane({ lane: 3 })] })];
    expect(laneColumnCount(4, heats)).toBe(4);
  });

  it('takes the larger of the two, not just one or the other', () => {
    const heats = [heat({ lanes: [lane({ lane: 5 })] })];
    expect(laneColumnCount(2, heats)).toBe(5);
    expect(laneColumnCount(8, heats)).toBe(8);
  });

  it('is the bare track lane count with no heats at all', () => {
    expect(laneColumnCount(4, [])).toBe(4);
  });
});

/**
 * Issue #1001. The Round Complete!/Race Complete! summaries need to name a
 * heat that was skipped and never re-run, not just know one exists.
 */
describe('skippedHeats', () => {
  it('is empty when nothing was skipped', () => {
    const heats = [
      heat({ id: 1, heatNumber: 1, lanes: [lane({ lane: 1, racerId: 1, time: 3.4, place: 1 })] }),
    ];
    expect(skippedHeats(heats)).toEqual([]);
  });

  it('names a skipped heat', () => {
    const skipped = heat({
      id: 2,
      heatNumber: 2,
      lanes: [lane({ lane: 1, racerId: 1, skipped: true })],
    });
    const heats = [
      heat({ id: 1, heatNumber: 1, lanes: [lane({ lane: 1, racerId: 1, time: 3.4, place: 1 })] }),
      skipped,
    ];
    expect(skippedHeats(heats)).toEqual([skipped]);
  });

  it('excludes a heat that was skipped and then re-run', () => {
    // `wasSkipped` already treats this as not-skipped; this just checks the
    // list version inherits it rather than re-deriving the rule.
    const heats = [
      heat({
        id: 1,
        heatNumber: 1,
        lanes: [lane({ lane: 1, racerId: 1, time: 3.4, skipped: true })],
      }),
    ];
    expect(skippedHeats(heats)).toEqual([]);
  });

  it('orders several skipped heats by heat number, not list order', () => {
    const later = heat({
      id: 1,
      heatNumber: 5,
      lanes: [lane({ lane: 1, racerId: 1, skipped: true })],
    });
    const earlier = heat({
      id: 2,
      heatNumber: 2,
      lanes: [lane({ lane: 1, racerId: 2, skipped: true })],
    });
    expect(skippedHeats([later, earlier])).toEqual([earlier, later]);
  });
});
