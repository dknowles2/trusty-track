import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Generates TypeScript types from the backend's GraphQL schema.
 *
 * `schema.graphql` is exported from the live Strawberry schema by
 * `scripts/export_schema.py`; `npm run codegen` runs both steps. CI regenerates
 * and fails if the checked-in output differs, so the schema and the frontend
 * types cannot drift apart silently.
 *
 * Schema and operation types are emitted to separate files with the
 * `import-types` preset. Putting both plugins in one file makes
 * typescript-operations re-declare every input type alongside the ones
 * typescript already emitted, which is a duplicate-identifier error.
 *
 * Operation types are only generated for documents written with urql's `gql`
 * tag — see src/gql/README.md.
 */
const sharedConfig = {
  skipTypename: true,
  enumsAsTypes: true,
};

const config: CodegenConfig = {
  schema: './schema.graphql',
  documents: ['src/**/*.{ts,tsx}', '!src/gql/**/*'],
  ignoreNoDocuments: true,
  generates: {
    './src/gql/schema.ts': {
      plugins: ['typescript'],
      config: sharedConfig,
    },
    './src/gql/operations.ts': {
      preset: 'import-types',
      presetConfig: {
        typesPath: './schema',
      },
      plugins: ['typescript-operations'],
      config: {
        ...sharedConfig,
        // Mirror the backend's nullability instead of widening every field to
        // optional: a selected field is always present in the response.
        avoidOptionals: {
          field: true,
          inputValue: false,
          object: false,
        },
      },
    },
  },
};

export default config;
