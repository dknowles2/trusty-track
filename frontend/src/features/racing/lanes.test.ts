import { describe, it, expect } from 'vitest';
import { hasTimes, hasRun, wasSkipped, byPlace, assignPlaces, toInput } from './lanes';
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
