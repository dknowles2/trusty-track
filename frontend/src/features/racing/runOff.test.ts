import { describe, expect, it } from 'vitest';
import { runOffAnnouncement, runOffCluster, tooManyForRunOff, usableLaneCount } from './runOff';

describe('runOffAnnouncement', () => {
  it('names the ordinal place being decided', () => {
    expect(runOffAnnouncement(2)).toBe('Racing off for 2nd place');
    expect(runOffAnnouncement(1)).toBe('Racing off for 1st place');
    expect(runOffAnnouncement(11)).toBe('Racing off for 11th place');
  });

  it('says nothing for null or undefined — not a run-off, or nothing left to settle', () => {
    expect(runOffAnnouncement(null)).toBeNull();
    expect(runOffAnnouncement(undefined)).toBeNull();
  });
});

/**
 * Issue #766. `crud.create_run_off_heat` refuses more racers than the
 * track's usable lanes (#171's own lane-outage-aware bound, not the raw
 * track `laneCount` — #303 already found and fixed three call sites that
 * got that distinction wrong). Before this, `RunOffControl` offered "Start
 * run-off" for a cluster of any size and let the server's refusal land as a
 * generic alert. These mirror `crud.usable_lanes_for_race`'s arithmetic so
 * the button can be disabled — with the reason showing — before the
 * operator ever clicks it.
 */
describe('usableLaneCount', () => {
  it('is the track\'s lane count when nothing is out of service', () => {
    expect(usableLaneCount(4, [])).toBe(4);
  });

  it('subtracts each lane marked out of service', () => {
    expect(usableLaneCount(4, [2])).toBe(3);
    expect(usableLaneCount(6, [1, 4])).toBe(4);
  });

  it('does not count a stale outage past the track\'s current lane count', () => {
    // A lane-outage row can outlive a track being reconfigured smaller
    // (`set_lane_outages` only prunes those on its next save) — this is the
    // same floor `usable_lanes_for_race`'s range-based computation gets for
    // free by only ever iterating `1..laneCount`.
    expect(usableLaneCount(4, [6])).toBe(4);
  });
});

describe('tooManyForRunOff', () => {
  it('says nothing when the track has room for every tied racer', () => {
    expect(tooManyForRunOff(3, 4)).toBeNull();
    expect(tooManyForRunOff(4, 4)).toBeNull();
  });

  it('says nothing when the usable lane count is not known — no track configured', () => {
    expect(tooManyForRunOff(5, null)).toBeNull();
  });

  it('names both counts when the cluster is wider than the track', () => {
    expect(tooManyForRunOff(5, 4)).toBe(
      'Not enough usable lanes for all 5 tied racers (only 4 available).',
    );
  });

  it('names the lane count even when it is exactly one', () => {
    expect(tooManyForRunOff(2, 1)).toBe(
      'Not enough usable lanes for all 2 tied racers (only 1 available).',
    );
  });
});


/**
 * Issue #1017. Before a tie is settled, `Leaderboard.tsx` groups a run-off
 * cluster by `rank`; once a run-off resolves it, the rows keep an identical
 * `score` but split ranks, and the control (with the only record of the
 * run-off's own times) has to keep finding them by that instead.
 */
describe('runOffCluster', () => {
  it('groups an unresolved tie by rank', () => {
    const entries = [
      { rank: 1, score: 3.1, resolvedBy: null },
      { rank: 1, score: 3.1, resolvedBy: null },
      { rank: 3, score: 3.4, resolvedBy: null },
    ];
    expect(runOffCluster(entries, 0)).toEqual([entries[0], entries[1]]);
    expect(runOffCluster(entries, 1)).toEqual([entries[0], entries[1]]);
    expect(runOffCluster(entries, 2)).toEqual([entries[2]]);
  });

  it('keeps finding a settled run-off cluster by its shared score', () => {
    const entries = [
      { rank: 1, score: 3.1, resolvedBy: 'RUN_OFF' },
      { rank: 2, score: 3.1, resolvedBy: 'RUN_OFF' },
      { rank: 3, score: 3.4, resolvedBy: null },
    ];
    expect(runOffCluster(entries, 0)).toEqual([entries[0], entries[1]]);
    expect(runOffCluster(entries, 1)).toEqual([entries[0], entries[1]]);
  });

  it('does not widen the grouping for an ordinary tiebreak policy', () => {
    // BEST_TIME never had a run-off heat to show — once it resolves the
    // tie, there is nothing here to keep finding.
    const entries = [
      { rank: 1, score: 3.1, resolvedBy: 'BEST_TIME' },
      { rank: 2, score: 3.1, resolvedBy: 'BEST_TIME' },
    ];
    expect(runOffCluster(entries, 0)).toEqual([entries[0]]);
    expect(runOffCluster(entries, 1)).toEqual([entries[1]]);
  });

  it('is empty past the end of the list', () => {
    expect(runOffCluster([{ rank: 1, score: 1, resolvedBy: null }], 5)).toEqual([]);
  });
});
