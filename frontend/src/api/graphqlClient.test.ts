import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMBEDDED_TYPES } from './graphqlClient';

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
