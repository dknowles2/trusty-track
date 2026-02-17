import { Client, cacheExchange, fetchExchange } from 'urql';

/**
 * GraphQL client configured to point to the backend's GraphQL endpoint.
 * The '/api' prefix is proxied by Vite to the backend server.
 */
export const graphqlClient = new Client({
  url: '/api/graphql',
  exchanges: [cacheExchange, fetchExchange],
});
