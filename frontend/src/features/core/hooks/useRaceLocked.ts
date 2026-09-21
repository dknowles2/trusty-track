import { useQuery } from 'urql';
import { GET_RACES_NAV } from '../graphql/queries';

/**
 * Whether a race is locked against further edits (#585), for a page that
 * needs the answer only for `RaceViewHeading`'s own `locked` prop and would
 * otherwise have to add `isLocked` to a query of its own (Standings, Stats,
 * Displays — none of the three fetches a `Race` today).
 *
 * Reads `GET_RACES_NAV` rather than opening a second query: `Navigation.tsx`
 * already fetches it on every race route, and it already carries `isLocked`
 * for the race pill's own badge — the cache answers this for free, and
 * `racesChanged` (which `Navigation.tsx` already subscribes to) keeps it
 * current the same way the pill already is.
 */
export function useRaceLocked(raceId: number): boolean {
  const [{ data }] = useQuery({ query: GET_RACES_NAV });
  const races: { id: number; isLocked: boolean }[] = data?.races || [];
  return races.find((r) => r.id === raceId)?.isLocked ?? false;
}
