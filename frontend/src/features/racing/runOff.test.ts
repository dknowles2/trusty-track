import { describe, expect, it } from 'vitest';
import { runOffAnnouncement, tooManyForRunOff, usableLaneCount } from './runOff';

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
