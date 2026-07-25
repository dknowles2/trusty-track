# Generated GraphQL types

**Everything in this directory is generated. Do not edit by hand.**

| File | Contents |
| --- | --- |
| `schema.ts` | Every type in the backend schema, including inputs and enums |
| `operations.ts` | Result and variable types for each named operation in `src/` |

## Regenerating

```bash
npm run codegen
```

That exports the SDL from the live Strawberry schema (`scripts/export_schema.py` → `frontend/schema.graphql`) and then runs `graphql-codegen`. Both `schema.graphql` and this directory are committed, so CI can regenerate and diff.

CI runs `npm run codegen:check`, which fails if the checked-in output is stale. **Changing `backend/api/schema.py` without regenerating will fail the build.**

## Which documents get operation types

Only documents written with urql's `gql` tag are discovered:

```ts
const MY_QUERY = gql`
  query MyQuery { ... }
`;
```

Several components still declare documents as plain template literals:

```ts
const MY_QUERY = `
  query MyQuery { ... }
`;
```

Those work at runtime — urql accepts strings — but codegen cannot find them, so they get no generated types. Adding the `gql` tag is enough to opt a document in.

Two other requirements, both enforced by codegen:

- Every operation must be **named** (no anonymous `query { ... }`)
- Operation names must be **unique across the app**

## Deriving view types

Prefer deriving from a generated operation type over hand-writing a shape. See `src/features/racing/types.ts`:

```ts
type RaceControlRace = NonNullable<GetRaceControlDataQuery['race']>;
export type Heat = RaceControlRace['heats'][number];
```

This keeps component props exactly in step with what the query returns, and a backend field rename becomes a compile error instead of a runtime `undefined`.
