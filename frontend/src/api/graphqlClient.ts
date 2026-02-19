import { Client, cacheExchange, fetchExchange, subscriptionExchange } from 'urql';
import { createClient as createWsClient } from 'graphql-ws';

/**
 * WebSocket client for GraphQL subscriptions.
 * Uses the same host/port as the page but with the ws(s):// scheme.
 */
const wsClient = createWsClient({
  url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/graphql`,
});

/**
 * GraphQL client configured to point to the backend's GraphQL endpoint.
 * The '/api' prefix is proxied by Vite to the backend server.
 * Includes subscriptionExchange for real-time WebSocket subscriptions.
 */
export const graphqlClient = new Client({
  url: '/api/graphql',
  exchanges: [
    cacheExchange,
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
