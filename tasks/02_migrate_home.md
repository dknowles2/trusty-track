# Task 2: Migrate Home Page

## Goal

Migrate `src/pages/Home.tsx` to use GraphQL.

## Steps

1.  **Update Queries**
    - Replace `apiClient.get('/races/')` with a GraphQL hook:
      ```graphql
      query GetRaces {
        races {
          id
          name
          dateTime
          location
          # Note: registered_count and checked_in_count might need to be computed fields in backend/graphql.py Racer type or added to Race type resolvers
        }
      }
      ```
    - **Backend Update Required**: Ensure `Race` type has `registered_count` and `checked_in_count` resolvers if not already present.

2.  **Update Mutations**
    - Replace `apiClient.post('/races/', data)` with `createRace` mutation.

3.  **Refactor Component**
    - Use `useQuery` and `useMutation` hooks from `urql`.
    - Update loading/error states.

## Verification

- **Update Tests**: Update `src/pages/Home.test.tsx` to mock GraphQL responses instead of REST calls.
- **Run Tests**: Ensure `npm test src/pages/Home.test.tsx` passes.
- Run the app and verify the Home page loads races.
- Verify creating a new race works.
