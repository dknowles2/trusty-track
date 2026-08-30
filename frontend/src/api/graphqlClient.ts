import { Client, fetchExchange, subscriptionExchange } from 'urql';
import { cacheExchange, type Data, type UpdateResolver } from '@urql/exchange-graphcache';
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
 * Close the subscription socket and stop retrying it.
 *
 * Exported for the demo's idle disconnect (`demoSession.ts`), which is the only
 * caller and should stay the only one: `graphql-ws` cannot be un-disposed, so
 * every live screen in the tab is finished afterwards and the way back is a
 * page load. That is the trade the demo wants — an instance holding a socket
 * open never scales to zero — and is exactly wrong anywhere else, where a
 * screen that has given up is a screen showing a heat that finished twenty
 * minutes ago.
 */
export function closeLiveConnection(): void {
  void wsClient.dispose();
}

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
  'AwardVoteTally',
  'RacingGroupStat',
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
  'Terminology',
  'TimerModel',
  'TimerStateChangedEvent',
  'TimerStatus',
  'TimesPerLane',
  'TimingStats',
  'TimingStatsLane',
  'TrackRecord',
  'TrackRecordBreak',
] as const;

/**
 * Types that are records but do not call their identity `id`.
 *
 * `Display` is keyed on `displayId` rather than embedded (#174). It genuinely
 * is a record — the same screen arrives from `displays(raceId)` for the
 * operator's list and from `displayAssignment` on the screen itself, and
 * `assignDisplay` returns it again. Embedded, the mutation result could not be
 * recognised as the row the list is already holding, and the panel would keep
 * showing the old view after the operator changed it. That is exactly the
 * `InitialConfigStatus` failure described above, which is why it is worth not
 * repeating.
 */
export const CUSTOM_KEYED_TYPES: Record<string, (data: Data) => string | null> = {
  Display: (data) => (typeof data.displayId === 'string' ? data.displayId : null),
};

const keys = {
  ...Object.fromEntries(EMBEDDED_TYPES.map((name) => [name, () => null])),
  ...CUSTOM_KEYED_TYPES,
};

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
 * `createPracticeRace` is registered here too, for the same reason as
 * `createRace` — it also inserts a `Race` and Home navigates straight to it
 * (see [#326](https://github.com/dknowles2/trusty-track/issues/326)). It was
 * missing the first time around: a race-creating mutation added after this
 * map was written has no reason to be noticed as one, which is why the list is
 * worth re-checking whenever a new one appears (a future restore path, say).
 *
 * Invalidating rather than splicing the new entity in: `createRace` selects
 * only `id`, while both readers want more than that, so there is nothing to
 * splice. "This answer is stale, ask again" needs no payload.
 */
const forgetRaceList: UpdateResolver = (_result, _args, cache) => {
  cache.invalidate('Query', 'races');
};

/**
 * Forget every cached race's resolved terminology when the organization
 * default changes (issue #531).
 *
 * `Race.terminology` is resolved server-side by layering a race's own
 * override over the organization default (#496 stage 4), so renaming the
 * organization default changes the value of a field graphcache has no reason
 * to suspect — nothing about the `Race` entity itself was touched by this
 * mutation. `Terminology` is embedded (see `EMBEDDED_TYPES` above), so there
 * is no entity of its own to invalidate directly.
 *
 * `cache.inspectFields('Query')` lists every root field the cache has
 * answered, including one `race(raceId: ...)` call per race a screen has
 * visited; `cache.resolve` turns each back into the `Race:N` key it wrote,
 * and `terminology` is invalidated on each in turn — "this answer is stale,
 * ask again", the same move `forgetInitialConfig` and `forgetRaceList` make.
 * A race the cache has never queried needs nothing done to it: it has no
 * stale `terminology` to hold.
 */
const forgetRaceTerminology: UpdateResolver = (_result, _args, cache) => {
  for (const field of cache.inspectFields('Query')) {
    if (field.fieldName !== 'race') continue;
    const raceKey = cache.resolve('Query', 'race', field.arguments ?? undefined);
    if (typeof raceKey === 'string') {
      cache.invalidate(raceKey, 'terminology');
    }
  }
};

/** Both consequences of a config save: the first-run gate's cached answer,
 * and every race's resolved terminology (issue #531). */
const forgetInitialConfigAndTerminology: UpdateResolver = (result, args, cache, info) => {
  forgetInitialConfig(result, args, cache, info);
  forgetRaceTerminology(result, args, cache, info);
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
      createInitialConfig: forgetInitialConfigAndTerminology,
      updateInitialConfig: forgetInitialConfigAndTerminology,
      createRace: forgetRaceList,
      createPracticeRace: forgetRaceList,
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
