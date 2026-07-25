import { describe, it, expect } from 'vitest';
import { shouldRefetch, type RaceStateChangedEvent } from './useRaceStateChanged';

/**
 * Issue #12. Before this, every race event triggered a full page re-query —
 * about 48 SQL queries across all open screens, whether the change was a
 * recorded heat result or a typo fixed in a racer's name.
 *
 * The failure mode to guard against is silence: if the predicate wrongly
 * returns true for everything, the app behaves exactly as it used to and
 * nothing looks broken. So the "does not refetch" cases matter more here than
 * the "does refetch" ones.
 */
const event = (over: Partial<RaceStateChangedEvent> = {}): RaceStateChangedEvent => ({
  raceId: 1,
  changedAt: '2026-07-25T00:00:00Z',
  kind: 'OTHER',
  ...over,
});

describe('shouldRefetch', () => {
  it('does not refetch a heat result that carries its heat', () => {
    expect(shouldRefetch(event({ kind: 'HEAT_RESULT', heat: { id: 7 } }))).toBe(false);
  });

  it('does not refetch a racer change that carries its racer', () => {
    expect(shouldRefetch(event({ kind: 'RACER', racer: { id: 3 } }))).toBe(false);
  });

  it('refetches when a mergeable kind arrives with no payload', () => {
    // Bulk mutations change many racers at once and send nothing to merge.
    expect(shouldRefetch(event({ kind: 'RACER' }))).toBe(true);
    expect(shouldRefetch(event({ kind: 'HEAT_RESULT' }))).toBe(true);
  });

  it('refetches when the roster changes', () => {
    // Graphcache will not add a new racer to race.racers or remove a deleted
    // one, so list membership always needs a re-read.
    expect(shouldRefetch(event({ kind: 'ROSTER', racer: { id: 3 } }))).toBe(true);
  });

  it('refetches on structural changes', () => {
    expect(shouldRefetch(event({ kind: 'SCHEDULE' }))).toBe(true);
    expect(shouldRefetch(event({ kind: 'RACE_SETTINGS' }))).toBe(true);
    expect(shouldRefetch(event({ kind: 'OTHER' }))).toBe(true);
  });

  it('refetches when the event has no kind at all', () => {
    // A server predating #12, or a payload shape we do not recognise.
    const legacy = { raceId: 1, changedAt: 'now' } as unknown as RaceStateChangedEvent;
    expect(shouldRefetch(legacy)).toBe(true);
  });

  it('does nothing when there is no event', () => {
    expect(shouldRefetch(undefined)).toBe(false);
    expect(shouldRefetch(null)).toBe(false);
  });
});
