import { useSubscription } from 'urql';
import { RACE_STATE_CHANGED_SUBSCRIPTION } from '../graphql/queries';

/**
 * What kind of change an event describes. Mirrors the backend's
 * `RaceChangeKind`; see `backend/api/schema.py`.
 */
export type RaceChangeKind =
  | 'HEAT_RESULT'
  | 'RACER'
  | 'ROSTER'
  | 'SCHEDULE'
  | 'RACE_SETTINGS'
  | 'OTHER';

/**
 * Kinds whose payload the normalized cache can merge on its own.
 *
 * Both carry a full entity keyed by `__typename` + `id`, and neither changes
 * which entities exist. Graphcache writes the payload into the cache and every
 * query already referencing that heat or racer updates in place — no refetch.
 *
 * Everything else changes list membership or race-level structure, which no
 * payload can express: graphcache will not add a new racer to `race.racers`, or
 * remove a deleted heat from `round.heats`. Those still need a re-read.
 */
const MERGEABLE_KINDS: ReadonlySet<RaceChangeKind> = new Set(['HEAT_RESULT', 'RACER']);

export interface RaceStateChangedEvent {
  raceId: number;
  changedAt: string;
  kind: RaceChangeKind;
  roundId?: number | null;
  heat?: { id: number } | null;
  racer?: { id: number } | null;
}

/**
 * urql hands the handler the whole subscription *result*, not the event, so the
 * payload has to be unwrapped. Getting this wrong is silent: `data.kind` reads
 * as undefined, every event looks unmergeable, and the page refetches exactly
 * as it did before — the change appears to work while doing nothing.
 */
export interface RaceStateChangedData {
  raceStateChanged: RaceStateChangedEvent;
}

/**
 * Subscribe to a race's changes and re-run `refetch` only when the change is
 * one the cache cannot apply by itself.
 *
 * Before issue #12 every event triggered a full page re-query, so recording one
 * heat result cost about 48 SQL queries across all open screens — the same as
 * correcting a typo in a racer's name. Now a heat result or a check-in carries
 * the updated entity and merges silently, and only structural changes refetch.
 *
 * A payload has to actually be present to be merged: bulk mutations report
 * `RACER` without one, since they change many racers at once. Those refetch.
 *
 * `options.alwaysRefetch` skips that gate and calls `refetch` on every event
 * regardless of kind or payload — for a caller whose query is not the `race`
 * entity graphcache merges into, so nothing about a "mergeable" kind applies
 * to it. The activity log (#1078) is the one user of this so far: a
 * `HEAT_RESULT` event that merges cleanly into `race.heats` elsewhere still
 * means a fresh audit entry exists that only a refetch of `auditLog` reveals.
 */
export function useRaceStateChanged(
  raceId: number | undefined,
  refetch: () => void,
  options: { pause?: boolean; alwaysRefetch?: boolean } = {}
) {
  const paused = options.pause ?? (!raceId || Number.isNaN(raceId));
  const alwaysRefetch = options.alwaysRefetch ?? false;

  return useSubscription<RaceStateChangedData, RaceStateChangedData>(
    { query: RACE_STATE_CHANGED_SUBSCRIPTION, variables: { raceId }, pause: paused },
    (_previous, data) => {
      // `shouldRefetch` is about whether the *normalized cache* can merge an
      // event's payload on its own (#12) — right for a page reading `race {
      // ... }`, wrong for a caller whose query is not that entity at all.
      // The activity log (#1078) is exactly that: a `HEAT_RESULT` event
      // merges a heat into the cache just fine, but it also means a new
      // audit entry was written that this hook's own gate would otherwise
      // swallow. `alwaysRefetch` opts out of the gate entirely for callers
      // like that one.
      const shouldCall = alwaysRefetch ? !!data?.raceStateChanged : shouldRefetch(data?.raceStateChanged);
      if (shouldCall) refetch();
      return data;
    }
  );
}

/** Exported for testing — the whole point of the change lives in this predicate. */
export function shouldRefetch(event: RaceStateChangedEvent | undefined | null): boolean {
  if (!event) return false;
  // An event with no kind is from a server older than #12, or a payload we do
  // not understand. Refetching is the safe answer.
  if (!event.kind || !MERGEABLE_KINDS.has(event.kind)) return true;
  // A mergeable kind with nothing to merge (bulk mutations) still needs a read.
  return !event.heat && !event.racer;
}
