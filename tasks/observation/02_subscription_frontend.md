# Task: Frontend GraphQL Subscriptions for Observation

## Goal

Replace the 5-second polling in `Observation.tsx` with GraphQL subscriptions for real-time race updates.

## Background

The current `Observation.tsx` uses `setInterval` polling to fetch race state every 5 seconds. GraphQL subscriptions are the natural next step given the project's GraphQL-first architecture — the same urql client already used for queries and mutations also supports subscriptions via `useSubscription`.

On the wire, urql subscriptions use the `graphql-ws` protocol (WebSocket under the hood), but all of that is transparent: from the component's perspective it's just another hook.

## Steps

1. **Add `graphql-ws` and Configure urql**
   - Install `graphql-ws` as a dependency: `npm install graphql-ws`
   - In `src/api/graphqlClient.ts`, add a `subscriptionExchange` to the urql client:
     ```ts
     import { createClient as createWsClient } from 'graphql-ws'
     import { subscriptionExchange } from 'urql'

     const wsClient = createWsClient({ url: 'ws://localhost:8000/graphql' })

     const client = createClient({
       url: '/graphql',
       exchanges: [
         // ...existing exchanges...
         subscriptionExchange({
           forwardSubscription: (request) => ({
             subscribe: (sink) => ({ unsubscribe: wsClient.subscribe(request, sink) }),
           }),
         }),
       ],
     })
     ```

2. **Define Subscription Operations**
   - Add subscription documents to `src/graphql/raceDetails.ts` (or a new `src/graphql/observation.ts`):
     ```graphql
     subscription LeaderboardSubscription($raceId: Int!) {
       leaderboard(raceId: $raceId) {
         rank
         racer { id firstName lastName carNumber denId }
         avgTime
         bestTime
         heatsCompleted
       }
     }

     subscription OnDeckSubscription($raceId: Int!) {
       onDeck(raceId: $raceId) { id firstName lastName carNumber }
     }

     subscription CurrentlyRacingSubscription($raceId: Int!) {
       currentlyRacing(raceId: $raceId) {
         id heatNumber
         laneResults { racerId laneNumber time place }
       }
     }

     subscription TimingStatsSubscription($raceId: Int!) {
       timingStats(raceId: $raceId) {
         heatId roundName heatNumber
         lanes { laneNumber racerName carName time place }
       }
     }
     ```

3. **Replace Polling in `Observation.tsx`**
   - Remove the `setInterval`-based polling and `useQuery`/`useEffect` fetch logic.
   - Use `useSubscription` from urql:
     ```ts
     const [{ data: leaderboardData }] = useSubscription({
       query: LeaderboardSubscriptionDocument,
       variables: { raceId },
     })
     ```
   - Show a "Connecting..." indicator while the subscription is establishing.

4. **Handle Subscription Lifecycle**
   - urql handles reconnection automatically when using `graphql-ws`.
   - Optionally show a subtle "reconnecting" badge if the connection drops.

## Verification

- Run the app and open `Observation.tsx`.
- Record a heat result in Race Control and verify `Observation.tsx` updates within ~1 second.
- Disconnect from the network briefly and verify the UI recovers on reconnect.
- Update `src/pages/Observation.test.tsx` to mock `useSubscription` instead of polling fetches.

## Dependencies

- Requires `01_subscription_backend.md` to be completed first.
