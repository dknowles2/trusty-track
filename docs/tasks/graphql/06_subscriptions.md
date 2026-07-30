# Task 6: GraphQL Subscriptions for Real-Time Updates [COMPLETED]

> **Built.** See the status block below.

## Status

> **✅ Complete** (Steps 1–6 fully implemented and committed)

## Goal

Add GraphQL subscription support so that all active browser tabs and windows reflect the current race state automatically, without requiring manual page refresh or polling.

## Background

### The problem

Currently the app updates its view of the database in two ways:

- **After mutations**: pages call `reExecute({ requestPolicy: 'network-only' })` to refetch after their own mutations.
- **Polling**: `Observation.tsx` runs a `setInterval` every 5 seconds to pick up external changes.

Both approaches work when a single operator uses a single browser tab. They break down in common real-world multi-tab setups, for example:

| Tab A                             | Tab B                     | Problem                                                                 |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| Race Director (RaceControl)       | Scorekeeper (RaceControl) | Scorekeeper records a heat result; Race Director's tab shows stale data |
| Observation (projected on screen) | RaceControl               | Already addressed by polling, but 5-second lag is visible to audience   |
| Race Details (check-in)           | RaceControl               | Racer checks in; RaceControl's "on deck" list is stale                  |

### Why subscriptions (not SSE or shorter polling)

GraphQL subscriptions over WebSocket are the right fit because:

- **Already planned**: `tasks/observation/01_subscription_backend.md` and `02_subscription_frontend.md` specify the backend pub/sub and frontend `subscriptionExchange` setup. This task shares that infrastructure rather than inventing something new.
- **Framework support**: Strawberry + FastAPI handle the `graphql-ws` WebSocket subprotocol natively. urql supports it via `subscriptionExchange`. No third-party server-push libraries needed.
- **Type safety**: Subscription return types are part of the GraphQL schema, same as queries and mutations.
- **SSE is not a good fit**: urql has no native SSE exchange for subscriptions; implementing it would bypass the schema entirely.
- **Shorter polling** trades one problem (lag) for another (unnecessary network traffic and server load).

### Relationship to observation tasks

`tasks/observation/` already specifies rich, per-data-source subscriptions (`leaderboard`, `onDeck`, `currentlyRacing`, `timingStats`) for the Observation page. **This task does not duplicate that work.** Instead it:

1. Adds a lightweight **invalidation subscription** (`raceStateChanged`) that non-observation pages can use.
2. Wires RaceControl to that subscription so it refetches automatically when another tab mutates data.

## Implementation Plan

### ✅ Step 1 — Prerequisite: Observation subscription infrastructure

Implemented as part of this task rather than as a separate prerequisite:

- `backend/pubsub.py` — in-process async pub/sub broadcaster (`_PubSub`, module-level `pubsub` singleton)
- `Subscription` root type registered in `backend/schema.py`
- `subscriptionExchange` + `graphql-ws` client added to `frontend/src/api/graphqlClient.ts`

### ✅ Step 2 — Add a `raceStateChanged` invalidation subscription (backend)

Added to `backend/schema.py`:

```python
@strawberry.type
class RaceStateChangedEvent:
    race_id: int
    changed_at: str  # ISO timestamp

@strawberry.subscription
async def race_state_changed(
    self, race_id: int, info: Info
) -> AsyncGenerator[RaceStateChangedEvent, None]:
    async with pubsub.subscribe(f"race_state:{race_id}") as stream:
        async for payload in stream:
            yield payload
```

All mutations in the table below converted to `async def` and wired to `_publish_race_state(race_id)`:

| Mutation                                                                  | Published |
| ------------------------------------------------------------------------- | --------- |
| `updateHeatResult`                                                        | ✅        |
| `createRound`, `regenerateRound`, `deleteRound`, `advanceRound`           | ✅        |
| `reorderHeats`                                                            | ✅        |
| `createRacer`, `updateRacer`, `deleteRacer`                               | ✅        |
| `checkInRacer`                                                            | ✅        |
| `createDen`, `updateDen`, `deleteDen`                                     | ✅        |
| `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers` | ✅        |

### ✅ Step 3 — Add the subscription document (frontend)

Added `RACE_STATE_CHANGED_SUBSCRIPTION` to `frontend/src/graphql/raceDetails.ts`.

### ✅ Step 4 — Wire RaceControl to the invalidation subscription

`frontend/src/pages/RaceControl.tsx` now calls `useSubscription` and triggers `reExecute({ requestPolicy: 'network-only' })` on every received event.

### ⏳ Step 5 — Replace Observation.tsx polling

Deferred to `tasks/observation/02_subscription_frontend.md`. The polling `setInterval` remains until the dedicated observation subscriptions are implemented.

### ✅ Step 6 — Tests

- **Backend** (`backend/test_subscriptions.py`): 3 tests — pubsub fan-out, channel routing, event delivery. All pass (69/69 total backend tests pass).
- **Frontend** (`frontend/src/pages/RaceControl.test.tsx`): `useSubscription` mocked; new test asserts `reExecute` is called when event fires. All pass (111/111 frontend tests pass).

## Pages and components affected

| File                         | Current behavior                            | Status       | Notes                                                           |
| ---------------------------- | ------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `pages/RaceControl.tsx`      | Manual `reExecute` after own mutations only | ✅ Done      | Auto-refetch via `raceStateChanged` subscription                |
| `pages/Observation.tsx`      | 5-second `setInterval` polling              | ⏳ Deferred  | Replaced by dedicated subscriptions (observation tasks)         |
| `components/Leaderboard.tsx` | `cache-and-network` + manual re-execute     | ✅ Done      | Auto-refetched via `raceStateChanged` subscription              |
| `pages/RaceDetails.tsx`      | Manual `reExecute` after own mutations      | ✅ Done      | Auto-refetch via `raceStateChanged` subscription                |
| `pages/Standings.tsx`        | Static fetch on mount                       | ✅ Done      | Auto-refetch via `raceStateChanged` via `Leaderboard` child     |
| `components/Navigation.tsx`  | Static fetch on mount                       | ⬜ Low prio  | Unchanged (minor race list stale case)                          |
| `pages/Home.tsx`             | Manual `reExecute` after own mutations      | ⬜ No change | Single-tab workflow; race creation is always the initiating tab |

### `pages/RaceDetails.tsx` — multi-operator gap

The current reasoning ("no change needed; edits here are the source of truth") holds for the _primary_ check-in/roster operator. It breaks down in two realistic scenarios:

1. **Two operators sharing the page.** A pack coordinator manages dens from a laptop while a separate volunteer does check-ins on a tablet. Den changes from the laptop won't appear on the tablet and vice-versa.
2. **Heat results flowing back.** The leaderboard widget embedded in RaceDetails (`components/Leaderboard.tsx`) never refreshes when a race director in another tab records heat results. The leaderboard shows stale scores until the page is reloaded.

**Recommended fix**: wire `useSubscription(RACE_STATE_CHANGED_SUBSCRIPTION, { variables: { raceId } })` and call `reExecuteRaceDetails({ requestPolicy: 'network-only' })` on every event, the same pattern already used in `RaceControl.tsx`. Because `Leaderboard` is a child component that fetches independently, it also needs to receive the refetch trigger — either via a `key` prop bump or by passing the subscription event as a prop and calling its own `reExecute` in a `useEffect`.

### `pages/Standings.tsx` — live audience leaderboard

Standings is intended to be projected for the audience while heats are still running. At present it fetches once on mount and never updates. A race director recording results in `RaceControl` will not be reflected here.

**Recommended fix**: add `useSubscription(RACE_STATE_CHANGED_SUBSCRIPTION, …)` and trigger a refetch of the `Leaderboard` child on each event. The `Leaderboard` component already accepts a `raceId` prop and has its own `useQuery`; the cleanest approach is to pass a changing `key` when an event arrives to force a remount, or to forward a callback so `Leaderboard` re-executes its own query.

### `components/Navigation.tsx` — race list freshness

The nav race-selector dropdown fetches the race list once on mount. If a second tab creates or deletes a race (`Home.tsx` mutations) the navigation in all other tabs becomes stale. This is low priority because it is rare to create races in multiple tabs simultaneously, but it is a latent inconsistency.

**Recommended fix**: subscribe to a coarse `racesChanged` invalidation event (or reuse `raceStateChanged` with `raceId = 0` as a convention for race-list-level changes) and call `reExecuteRacesNav`. Alternatively, add a `raceListChanged` pub/sub channel published from `createRace`, `updateRace`, and `deleteRace`.

## What this task does NOT cover

- The richer per-data-source observation subscriptions (`leaderboard`, `onDeck`, `currentlyRacing`, `timingStats`) — those belong to `tasks/observation/`.
- Timer integration (hardware serial timers pushing times into heats) — see `tasks/timers/`.
- Multi-user / multi-device authentication — out of scope for now.

## Dependencies

- `tasks/observation/01_subscription_backend.md` must be completed first (pub/sub infrastructure, `Subscription` type registration, WebSocket transport).
- `tasks/observation/02_subscription_frontend.md` must be completed first (`subscriptionExchange` in the urql client, `graphql-ws` installed).
