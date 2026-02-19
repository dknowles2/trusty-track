# Task 6: GraphQL Subscriptions for Real-Time Updates

## Goal

Add GraphQL subscription support so that all active browser tabs and windows reflect the current race state automatically, without requiring manual page refresh or polling.

## Background

### The problem

Currently the app updates its view of the database in two ways:

- **After mutations**: pages call `reExecute({ requestPolicy: 'network-only' })` to refetch after their own mutations.
- **Polling**: `Observation.tsx` runs a `setInterval` every 5 seconds to pick up external changes.

Both approaches work when a single operator uses a single browser tab. They break down in common real-world multi-tab setups, for example:

| Tab A | Tab B | Problem |
|---|---|---|
| Race Director (RaceControl) | Scorekeeper (RaceControl) | Scorekeeper records a heat result; Race Director's tab shows stale data |
| Observation (projected on screen) | RaceControl | Already addressed by polling, but 5-second lag is visible to audience |
| Race Details (check-in) | RaceControl | Racer checks in; RaceControl's "on deck" list is stale |

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

### Step 1 — Prerequisite: Observation subscription infrastructure

Complete `tasks/observation/01_subscription_backend.md` and `tasks/observation/02_subscription_frontend.md` first. They establish:

- `backend/pubsub.py` — in-process async pub/sub broadcaster
- `Subscription` root type in `backend/schema.py`
- `subscriptionExchange` + `graphql-ws` client in `frontend/src/api/graphqlClient.ts`

### Step 2 — Add a `raceStateChanged` invalidation subscription (backend)

Add a single, lightweight subscription to `backend/schema.py` alongside the richer observation subscriptions. It fires whenever any significant mutation modifies a race's data:

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

Publish to `race_state:{race_id}` at the end of every mutation that modifies race data:

| Mutation | Publish? |
|---|---|
| `updateHeatResult` | Yes |
| `createRound`, `regenerateRound`, `deleteRound`, `advanceRound` | Yes |
| `reorderHeats` | Yes |
| `createRacer`, `updateRacer`, `deleteRacer` | Yes |
| `checkInRacer` | Yes |
| `createDen`, `updateDen`, `deleteDen` | Yes |
| `bulkAutoNumber`, `bulkClearNumbers`, `bulkMoveToDen`, `bulkDeleteRacers` | Yes |

Helper to publish from a mutation resolver (call after the DB commit):

```python
async def _publish_race_state(race_id: int):
    from datetime import datetime, timezone
    await pubsub.publish(
        f"race_state:{race_id}",
        RaceStateChangedEvent(
            race_id=race_id,
            changed_at=datetime.now(timezone.utc).isoformat(),
        ),
    )
```

### Step 3 — Add the subscription document (frontend)

Add to `frontend/src/graphql/raceDetails.ts`:

```ts
export const RACE_STATE_CHANGED_SUBSCRIPTION = `
  subscription RaceStateChanged($raceId: Int!) {
    raceStateChanged(raceId: $raceId) {
      raceId
      changedAt
    }
  }
`;
```

### Step 4 — Wire RaceControl to the invalidation subscription

In `frontend/src/pages/RaceControl.tsx`, replace the scattered `reExecute({ requestPolicy: 'network-only' })` calls (triggered only after *this tab's* own mutations) with an automatic refetch driven by the subscription:

```ts
import { useSubscription } from 'urql';
import { RACE_STATE_CHANGED_SUBSCRIPTION } from '../graphql/raceDetails';

// Inside the component:
useSubscription(
  { query: RACE_STATE_CHANGED_SUBSCRIPTION, variables: { raceId } },
  (_prev, data) => {
    // Any change from any tab triggers a fresh fetch.
    reExecute({ requestPolicy: 'network-only' });
    return data;
  }
);
```

The existing `reExecute` calls after this tab's own mutations can be removed — the subscription will handle the refetch for all tabs, including the one that originated the mutation.

### Step 5 — Replace Observation.tsx polling

Once `tasks/observation/02_subscription_frontend.md` is complete, delete the `setInterval` in `Observation.tsx`. The dedicated leaderboard/onDeck/currentlyRacing subscriptions provide sub-second updates with no polling overhead.

### Step 6 — Tests

**Backend** (`backend/test_subscriptions.py`):
- Subscribe to `raceStateChanged(raceId)`.
- Call `updateHeatResult` mutation.
- Assert the subscription emits a `RaceStateChangedEvent` with the correct `raceId`.

**Frontend** (`frontend/src/pages/RaceControl.test.tsx`):
- Mock `useSubscription` to emit a `raceStateChanged` event.
- Assert the component calls `reExecute` in response.

## Pages and components affected

| File | Current behavior | After this task |
|---|---|---|
| `pages/RaceControl.tsx` | Manual `reExecute` after own mutations only | Auto-refetch via `raceStateChanged` subscription |
| `pages/Observation.tsx` | 5-second `setInterval` polling | Replaced by dedicated subscriptions (observation tasks) |
| `components/Leaderboard.tsx` | `cache-and-network` + manual re-execute | Driven by `raceStateChanged` from parent, or its own subscription |
| `pages/RaceDetails.tsx` | Manual `reExecute` after own mutations | No change needed (edits here are the source of truth) |
| `pages/Home.tsx` | Manual `reExecute` after own mutations | No change needed (single-tab workflow) |

## What this task does NOT cover

- The richer per-data-source observation subscriptions (`leaderboard`, `onDeck`, `currentlyRacing`, `timingStats`) — those belong to `tasks/observation/`.
- Timer integration (hardware serial timers pushing times into heats) — see `tasks/timers/`.
- Multi-user / multi-device authentication — out of scope for now.

## Dependencies

- `tasks/observation/01_subscription_backend.md` must be completed first (pub/sub infrastructure, `Subscription` type registration, WebSocket transport).
- `tasks/observation/02_subscription_frontend.md` must be completed first (`subscriptionExchange` in the urql client, `graphql-ws` installed).
