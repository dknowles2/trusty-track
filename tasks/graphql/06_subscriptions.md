# Task 6: GraphQL Subscriptions for Real-Time Updates

## Status

> **✅ Complete** (Steps 1–4, 6 implemented and committed; Step 5 deferred to observation tasks)

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

| File                         | Current behavior                            | After this task                                                   |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `pages/RaceControl.tsx`      | Manual `reExecute` after own mutations only | Auto-refetch via `raceStateChanged` subscription                  |
| `pages/Observation.tsx`      | 5-second `setInterval` polling              | Replaced by dedicated subscriptions (observation tasks)           |
| `components/Leaderboard.tsx` | `cache-and-network` + manual re-execute     | Driven by `raceStateChanged` from parent, or its own subscription |
| `pages/RaceDetails.tsx`      | Manual `reExecute` after own mutations      | No change needed (edits here are the source of truth)             |
| `pages/Home.tsx`             | Manual `reExecute` after own mutations      | No change needed (single-tab workflow)                            |

## What this task does NOT cover

- The richer per-data-source observation subscriptions (`leaderboard`, `onDeck`, `currentlyRacing`, `timingStats`) — those belong to `tasks/observation/`.
- Timer integration (hardware serial timers pushing times into heats) — see `tasks/timers/`.
- Multi-user / multi-device authentication — out of scope for now.

## Dependencies

- `tasks/observation/01_subscription_backend.md` must be completed first (pub/sub infrastructure, `Subscription` type registration, WebSocket transport).
- `tasks/observation/02_subscription_frontend.md` must be completed first (`subscriptionExchange` in the urql client, `graphql-ws` installed).
