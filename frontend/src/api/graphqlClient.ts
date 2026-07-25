import { Client, fetchExchange, subscriptionExchange } from 'urql';
import { cacheExchange } from '@urql/exchange-graphcache';
import { createClient as createWsClient } from 'graphql-ws';

/**
 * WebSocket client for GraphQL subscriptions.
 * Uses the same host/port as the page but with the ws(s):// scheme.
 */
const wsClient = createWsClient({
  url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/graphql`,
});

/**
 * Types with no `id`, which graphcache has to be told about explicitly.
 *
 * Returning `null` marks a type as *embedded*: it has no identity of its own
 * and is stored inside whichever entity contains it. That is right for computed
 * rows — a leaderboard entry or a lane result is a view of data, not a record.
 *
 * `LeaderboardEntry` and `AdvancementRacer` do carry a `racerId`, and keying on
 * it would be a mistake: the same racer appears in the prelim standings and in
 * a championship round's standings with different scores and ranks, so the two
 * rows would collide and overwrite each other.
 *
 * `graphqlClient.test.ts` asserts this list matches `schema.graphql` exactly,
 * so adding a type without an `id` fails the build rather than silently
 * producing an unkeyable entity at runtime.
 */
export const EMBEDDED_TYPES = [
  'AdvancementRacer',
  'AdvancementStatus',
  'DenStat',
  'FreeRaceLaneAssignment',
  'HeatHighlight',
  'HeatReorderResponse',
  'HeatResultRow',
  'InitialConfigStatus',
  'LaneResult',
  'LaneTimeStat',
  'LeaderboardEntry',
  'RaceStateChangedEvent',
  'RaceStats',
  'RacerStat',
  'SerialLogEntry',
  'TimerStateChangedEvent',
  'TimerStatus',
  'TimesPerLane',
  'TimingStats',
  'TimingStatsLane',
] as const;

const keys = Object.fromEntries(EMBEDDED_TYPES.map((name) => [name, () => null]));

/**
 * GraphQL client configured to point to the backend's GraphQL endpoint.
 * The '/api' prefix is proxied by Vite to the backend server.
 *
 * The cache is **normalized** (`@urql/exchange-graphcache`) rather than urql's
 * default document cache. Entities are stored once under `__typename` plus
 * `id`, so a subscription payload carrying an updated `Heat` merges into every
 * query result that already referenced that heat, with no refetch. That is the
 * point of issue #12 — `raceStateChanged` used to be a bare poke and each
 * subscriber answered it by re-querying its whole page.
 *
 * Note graphcache cannot infer *list membership*. A new racer does not appear
 * in `race.racers` on its own, which is why the backend distinguishes `RACER`
 * (fields changed on an existing racer — safe to merge) from `ROSTER` (racers
 * added, removed, or moved — the list has to be re-read). Subscribers use that
 * distinction; see `useRaceStateChanged`.
 */
export const graphqlClient = new Client({
  url: '/api/graphql',
  exchanges: [
    cacheExchange({ keys }),
    fetchExchange,
    subscriptionExchange({
      forwardSubscription: (request) => ({
        subscribe: (sink) => ({
          unsubscribe: wsClient.subscribe(request as Parameters<typeof wsClient.subscribe>[0], sink),
        }),
      }),
    }),
  ],
});
