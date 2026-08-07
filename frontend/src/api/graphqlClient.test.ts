import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, gql, type Exchange, type OperationResult } from 'urql';
import { cacheExchange } from '@urql/exchange-graphcache';
import { pipe, map, filter } from 'wonka';
import { CACHE_CONFIG, EMBEDDED_TYPES } from './graphqlClient';

// Vitest runs with the frontend directory as cwd.
const schemaPath = resolve(process.cwd(), 'schema.graphql');

/**
 * Graphcache needs a key for every object type. Types with an `id` key
 * themselves; everything else must be declared embedded, or graphcache treats
 * it as an unkeyable entity at runtime — which degrades caching quietly rather
 * than failing loudly.
 *
 * The schema is generated from the backend, so this list can go stale without
 * anyone touching this file. Checking it here means a new type without an `id`
 * fails CI instead of showing up as a stale audience display mid-event.
 */
function typesWithoutAnId(): string[] {
  const sdl = readFileSync(schemaPath, 'utf8');
  const names: string[] = [];
  const typeBlock = /^type (\w+) \{([\s\S]*?)^\}/gm;

  for (const [, name, body] of sdl.matchAll(typeBlock)) {
    // Root types are never cached as entities.
    if (name === 'Query' || name === 'Mutation' || name === 'Subscription') continue;
    const hasId = /^\s+id:/m.test(body);
    if (!hasId) names.push(name);
  }
  return names.sort();
}

describe('graphcache key configuration', () => {
  it('declares every id-less type as embedded', () => {
    expect([...EMBEDDED_TYPES].sort()).toEqual(typesWithoutAnId());
  });

  it('does not declare types that graphcache can key on their own id', () => {
    const sdl = readFileSync(schemaPath, 'utf8');
    for (const name of EMBEDDED_TYPES) {
      const block = sdl.match(new RegExp(`^type ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
      expect(block, `type ${name} is no longer in the schema`).toBeTruthy();
      expect(/^\s+id:/m.test(block![1]), `${name} has an id and should be keyed`).toBe(false);
    }
  });
});

/**
 * The first-run gate reads `initialConfig`; the setup page writes it with
 * `createInitialConfig` / `updateInitialConfig`. `InitialConfigStatus` is
 * embedded, so graphcache cannot recognise what the mutation returns as the
 * same object the query is holding — and the cache went on saying the system
 * was unconfigured after the operator had just configured it. `ProtectedRoute`
 * bounced them back to the setup page they had come from. Saving a second time
 * worked, which is why it read as a glitch rather than a bug.
 */
describe('the cached race list and the mutations that change it', () => {
  const RACES = gql`
    query CacheTestGetRaces {
      races {
        id
        name
      }
    }
  `;

  const CREATE_RACE = gql`
    mutation CacheTestCreateRace {
      createRace(race: { name: "Derby", groupId: 1, trackId: 1 }) {
        id
      }
    }
  `;

  function clientReplying(answers: object[]) {
    const asked: string[] = [];
    const stub: Exchange = () => (ops$) =>
      pipe(
        ops$,
        filter((op) => op.kind !== 'teardown'),
        map((op) => {
          asked.push(op.kind);
          return {
            operation: op,
            data: answers[asked.length - 1],
            stale: false,
            hasNext: false,
          } as OperationResult;
        }),
      );

    return {
      client: new Client({ url: '/graphql', exchanges: [cacheExchange(CACHE_CONFIG), stub] }),
      queries: () => asked.filter((k) => k === 'query').length,
    };
  }

  const oneRace = { races: [{ __typename: 'Race', id: 1, name: 'Derby' }] };
  const twoRaces = {
    races: [
      { __typename: 'Race', id: 1, name: 'Derby' },
      { __typename: 'Race', id: 2, name: 'Second Derby' },
    ],
  };
  const created = { createRace: { __typename: 'Race', id: 2 } };

  it('asks again after a race is created', async () => {
    // Characterisation, not a guard on our own configuration: graphcache does
    // this by itself, and `CACHE_CONFIG` says nothing about `createRace`.
    //
    // Worth pinning anyway, because the home page now *relies* on it. Creating
    // a race navigates straight to it, so nothing refetches the list on the way
    // out; if this invalidation ever stopped happening, the operator would come
    // back to a list missing the race they had just made, and it would read as
    // the creation having failed.
    //
    // I nearly added an updater for this. Removing it changed nothing here —
    // two queries either way — which is how it turned out to be unnecessary.
    const { client, queries } = clientReplying([oneRace, created, twoRaces]);

    await client.query(RACES, {}).toPromise();
    await client.mutation(CREATE_RACE, {}).toPromise();
    const after = await client.query(RACES, {}).toPromise();

    expect(queries()).toBe(2);
    expect(after.data.races).toHaveLength(2);
  });

  it('still answers a repeated query from the cache when nothing has changed', async () => {
    const { client, queries } = clientReplying([oneRace, oneRace]);

    await client.query(RACES, {}).toPromise();
    await client.query(RACES, {}).toPromise();

    expect(queries()).toBe(1);
  });
});

describe('config mutations and the cached answer to initialConfig', () => {
  const CONFIG_QUERY = gql`
    query GetInitialConfig {
      initialConfig {
        initialized
        version
      }
    }
  `;

  const CREATE = gql`
    mutation CreateInitialConfig {
      createInitialConfig(config: { groupName: "Pack 123", tracks: [] }) {
        initialized
      }
    }
  `;

  const UPDATE = gql`
    mutation UpdateInitialConfig {
      updateInitialConfig(config: { groupName: "Pack 123", tracks: [] }) {
        initialized
      }
    }
  `;

  /** A client whose network layer is a list of canned answers. */
  function clientReplying(answers: object[]) {
    const asked: string[] = [];
    const stub: Exchange = () => (ops$) =>
      pipe(
        ops$,
        filter((op) => op.kind !== 'teardown'),
        map((op) => {
          asked.push(op.kind);
          return {
            operation: op,
            data: answers[asked.length - 1],
            stale: false,
            hasNext: false,
          } as OperationResult;
        }),
      );

    return {
      client: new Client({ url: '/graphql', exchanges: [cacheExchange(CACHE_CONFIG), stub] }),
      queries: () => asked.filter((k) => k === 'query').length,
    };
  }

  const unconfigured = { initialConfig: { __typename: 'InitialConfigStatus', initialized: false, version: '1' } };
  const configured = { initialConfig: { __typename: 'InitialConfigStatus', initialized: true, version: '1' } };
  const saved = { createInitialConfig: { __typename: 'InitialConfigStatus', initialized: true } };
  const resaved = { updateInitialConfig: { __typename: 'InitialConfigStatus', initialized: true } };

  it('asks again after the config is created', async () => {
    const { client, queries } = clientReplying([unconfigured, saved, configured]);

    await client.query(CONFIG_QUERY, {}).toPromise();
    await client.mutation(CREATE, {}).toPromise();
    const after = await client.query(CONFIG_QUERY, {}).toPromise();

    expect(queries()).toBe(2);
    expect(after.data.initialConfig.initialized).toBe(true);
  });

  it('asks again after the config is updated', async () => {
    const { client, queries } = clientReplying([configured, resaved, configured]);

    await client.query(CONFIG_QUERY, {}).toPromise();
    await client.mutation(UPDATE, {}).toPromise();
    await client.query(CONFIG_QUERY, {}).toPromise();

    expect(queries()).toBe(2);
  });

  it('still answers a repeated query from the cache when nothing has changed', () => {
    // The invalidation has to be the mutation's doing, not a cache that has
    // stopped caching — the gate runs on every route change.
    const { client, queries } = clientReplying([unconfigured, unconfigured]);

    return client
      .query(CONFIG_QUERY, {})
      .toPromise()
      .then(() => client.query(CONFIG_QUERY, {}).toPromise())
      .then(() => expect(queries()).toBe(1));
  });
});
