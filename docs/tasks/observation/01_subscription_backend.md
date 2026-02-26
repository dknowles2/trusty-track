# [COMPLETED] Task: Backend GraphQL Subscriptions for Observation

## Goal

Add GraphQL subscriptions to the backend so observation clients can receive real-time race updates without polling.

## Background

The project is GraphQL-first (Strawberry + FastAPI). Subscriptions are the GraphQL-native mechanism for server-to-client push, and keep everything in the same schema with the same type safety as queries and mutations.

Strawberry supports subscriptions via the `@strawberry.subscription` decorator using Python async generators. FastAPI delivers them over WebSockets transparently via the `graphql-ws` subprotocol — the raw WebSocket plumbing is handled by the library, not by application code.

## Steps

1. **Add Dependency**
   - Add `strawberry-graphql[fastapi]` already covers subscriptions; verify that the installed version supports them.
   - No additional packages required on the backend side — Strawberry + FastAPI handle the `graphql-ws` protocol natively.

2. **Add a Pub/Sub Broadcaster**
   - Create `backend/pubsub.py` with a simple in-process broadcaster (e.g., using `asyncio.Queue` per subscriber or a broadcast library like `broadcaster`).
   - Expose a `publish(channel: str, payload: Any)` coroutine and a `subscribe(channel: str)` async context manager that yields payloads.
   - Channels: `"leaderboard:{race_id}"`, `"on_deck:{race_id}"`, `"currently_racing:{race_id}"`, `"timing_stats:{race_id}"`, `"heats:{race_id}"`.

3. **Define Subscription Types**
   - In `backend/graphql.py`, add a `Subscription` root type with these fields:

     ```python
     @strawberry.subscription
     async def leaderboard(self, race_id: int) -> AsyncGenerator[list[LeaderboardEntryType], None]:
         async with pubsub.subscribe(f"leaderboard:{race_id}") as stream:
             # emit current state immediately on connect
             yield get_current_leaderboard(race_id)
             async for payload in stream:
                 yield payload

     @strawberry.subscription
     async def on_deck(self, race_id: int) -> AsyncGenerator[list[RacerType], None]: ...

     @strawberry.subscription
     async def currently_racing(self, race_id: int) -> AsyncGenerator[HeatType | None, None]: ...

     @strawberry.subscription
     async def timing_stats(self, race_id: int) -> AsyncGenerator[TimingStatsType | None, None]: ...

     @strawberry.subscription
     async def heats(self, race_id: int) -> AsyncGenerator[list[RoundType], None]: ...
     ```

   - Each subscription emits the current state immediately on connect, then emits on every relevant state change.

4. **Trigger Publishes from Mutations**
   - After `update_heat_result`: publish to `leaderboard`, `timing_stats`, `currently_racing`, and `heats` channels.
   - After `advance_round`: publish to `on_deck` and `currently_racing`.
   - After `regenerate_round` / `delete_round`: publish to `heats`.

5. **Register the Subscription Type**
   - Pass `subscription=Subscription` to the `strawberry.Schema(...)` call.
   - Ensure the FastAPI app mounts the GraphQL router with WebSocket support (Strawberry's `GraphQLRouter` does this automatically).

## Verification

- Write tests in `backend/test_subscriptions.py` using Strawberry's test client with async support.
- Test that subscribing to `leaderboard` receives an initial payload.
- Test that calling `update_heat_result` triggers a leaderboard update to subscribers.
- Run `pytest backend/test_subscriptions.py`.

## Dependencies

- This is a prerequisite for `02_subscription_frontend.md`.
