import { Client, fetchExchange, subscriptionExchange } from 'urql';
import { cacheExchange, type UpdateResolver } from '@urql/exchange-graphcache';
import { createClient as createWsClient } from 'graphql-ws';
import { liveConnectionOptions } from './liveConnection';
import { pinHeaders, withPin } from './pin';

/**
 * WebSocket client for GraphQL subscriptions.
 * Uses the same host/port as the page but with the ws(s):// scheme.
 *
 * The retry and keep-alive settings are not `graphql-ws`'s defaults, and
 * `liveConnection.ts` explains why in full. Briefly: this runs on a Pi at a
 * venue with screens on wifi, where giving up after five reconnections leaves a
 * display frozen for the rest of the event, and never pinging means a half-open
 * connection is never noticed at all.
 */
const wsClient = createWsClient(
  liveConnectionOptions(
    withPin(
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/graphql`,
    ),
  ),
);

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
 * `TimerModel` does have a stable `key`, and is embedded anyway. It is a
 * catalogue the server compiles in — the same list for every caller, changing
 * only when the app is upgraded — so there is nothing for identity to buy, and
 * a keyed entity would outlive the query that fetched it for no reason.
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
  'HeatLane',
  'HeatReorderResponse',
  'HeatResultRow',
  'HeatSession',
  'InitialConfigStatus',
  'LaneResult',
  'LaneTimeStat',
  'LeaderboardEntry',
  'LiveLane',
  'RaceStateChangedEvent',
  'RaceStats',
  'RacerStat',
  'SerialLogEntry',
  'TimerModel',
  'TimerStateChangedEvent',
  'TimerStatus',
  'TimesPerLane',
  'TimingStats',
  'TimingStatsLane',
] as const;

const keys = Object.fromEntries(EMBEDDED_TYPES.map((name) => [name, () => null]));

/**
 * Forget the cached answer to `initialConfig` once it has been changed.
 *
 * `InitialConfigStatus` is embedded — it has no `id`, so graphcache cannot
 * recognise the object a config mutation returns as the same one
 * `Query.initialConfig` is holding. Without this, the cache goes on saying the
 * system is unconfigured after the operator has just configured it, and
 * `ProtectedRoute` bounces them straight back to the setup page they came
 * from. Saving again worked, which is why it read as a glitch rather than a
 * bug.
 *
 * Invalidating rather than writing the result in: the two documents that read
 * this field select different fields of it, and a mutation's payload is not
 * guaranteed to cover either. "This answer is stale, ask again" needs no such
 * guarantee.
 */
const forgetInitialConfig: UpdateResolver = (_result, _args, cache) => {
  cache.invalidate('Query', 'initialConfig');
};

/**
 * Forget the cached race list when a race is created or deleted.
 *
 * `Query.races` is a root list, and graphcache has no way to know a new `Race`
 * belongs in it — a normalized cache tracks entities, not which collections
 * ought to contain them.
 *
 * Two screens read that list, and the one that suffers is not the obvious one.
 * `Navigation` resolves the *name* of the race you are looking at by finding
 * its id in `races`, so a race missing from the cached list leaves the header
 * reading "Select a Race" while you are standing on that race's own page.
 *
 * Invalidating rather than splicing the new entity in: `createRace` selects
 * only `id`, while both readers want more than that, so there is nothing to
 * splice. "This answer is stale, ask again" needs no payload.
 */
const forgetRaceList: UpdateResolver = (_result, _args, cache) => {
  cache.invalidate('Query', 'races');
};

/**
 * The cache's whole configuration, exported so a test can build a client with
 * it. Testing the real thing matters here: what broke was not a component but
 * the agreement between a mutation and a query about one cached field.
 */
export const CACHE_CONFIG = {
  keys,
  updates: {
    Mutation: {
      createInitialConfig: forgetInitialConfig,
      updateInitialConfig: forgetInitialConfig,
      createRace: forgetRaceList,
      deleteRace: forgetRaceList,
    },
  },
};

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
  // Read per request rather than captured once: the operator can enter a PIN
  // without reloading, and the next mutation carries it. The socket cannot do
  // the same — a WebSocket handshake sets no headers, so it takes the PIN in
  // its URL and a change to it needs a reconnect. `usePin` handles that.
  fetchOptions: () => ({ headers: pinHeaders() }),
  exchanges: [
    cacheExchange(CACHE_CONFIG),
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
