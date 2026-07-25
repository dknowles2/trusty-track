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
 */
export function useRaceStateChanged(
  raceId: number | undefined,
  refetch: () => void,
  options: { pause?: boolean } = {}
) {
  const paused = options.pause ?? (!raceId || Number.isNaN(raceId));

  return useSubscription<RaceStateChangedData, RaceStateChangedData>(
    { query: RACE_STATE_CHANGED_SUBSCRIPTION, variables: { raceId }, pause: paused },
    (_previous, data) => {
      if (shouldRefetch(data?.raceStateChanged)) refetch();
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
