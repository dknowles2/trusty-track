# Task 0: Infrastructure Setup

## Goal

Set up the frontend infrastructure to support GraphQL operations using `urql` and `graphql-codegen` (optional but recommended, though we might skip codegen for now to keep it simple as requested). We will use `urql` as the client.

## Steps

1.  **Install Dependencies**

    ```npx
    npm install urql graphql
    ```

2.  **Configure GraphQL Client**
    - Create `src/api/graphqlClient.ts`.
    - Configure the client to point to `/api/graphql` (proxied by Vite).
    - Ensure it handles errors gracefully.

3.  **Wrap App Provider**
    - Update `src/App.tsx` (or `main.tsx`) to wrap the application with `Provider` from `urql`.

## Verification

- Create a simple temporary component `src/components/GraphQLTest.tsx` that queries the server status or a simple list.
- Run the app and verify the query succeeds.
- **Run Tests**: Ensure `npm test` still passes for existing components (no regressions).
