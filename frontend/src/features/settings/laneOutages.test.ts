import { describe, expect, it } from 'vitest';
import { lanesOf, outageSummary, toggleLane } from './laneOutages';

describe('toggling a lane', () => {
  it('takes a working lane out of service', () => {
    expect(toggleLane([], 3)).toEqual([3]);
  });

  it('puts a repaired lane back', () => {
    expect(toggleLane([2, 3], 3)).toEqual([2]);
  });

  it('keeps the result sorted', () => {
    // The server stores a set; a list that came back [4, 2] would render the
    // summary in that order.
    expect(toggleLane([4], 2)).toEqual([2, 4]);
  });

  it('does not mutate what it was given', () => {
    const outages = [2];
    toggleLane(outages, 3);
    expect(outages).toEqual([2]);
  });
});

describe('listing a track’s lanes', () => {
  it('numbers them from one', () => {
    expect(lanesOf(4)).toEqual([1, 2, 3, 4]);
  });

  it('copes with a track that has none', () => {
    expect(lanesOf(0)).toEqual([]);
    expect(lanesOf(-1)).toEqual([]);
  });
});

describe('summarising a track', () => {
  it('says so when everything works', () => {
    expect(outageSummary(4, [])).toBe('All 4 lanes in use');
  });

  it('leads with how many lanes are left, which is the number that decides', () => {
    expect(outageSummary(4, [3])).toBe(
      '3 of 4 lanes in use — Lane 3 out of service',
    );
  });

  it('pluralises', () => {
    expect(outageSummary(4, [2, 3])).toBe(
      '2 of 4 lanes in use — Lanes 2, 3 out of service',
    );
  });

  it('warns when nothing can be scheduled', () => {
    // The backend schedules nothing rather than heats of empty lanes, so the
    // operator needs to know why the round they just asked for is missing.
    expect(outageSummary(2, [1, 2])).toBe(
      'No usable lanes — no schedule can be generated',
    );
  });
});
