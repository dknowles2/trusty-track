# Task 3: Migrate Race Details

## Goal

Migrate `src/pages/RaceDetails.tsx` and related components (`RacerForm`, `DenManager`, etc.) to use GraphQL.

## Steps

1.  **Define Queries**
    - Create a comprehensive query for the page:
      ```graphql
      query GetRaceDetails($raceId: Int!) {
        race(raceId: $raceId) {
          id
          name
          dateTime
          location
          scoringStrategy
          carNumberingStrategy
          championshipTrophies
          trackId
          track {
            id
            name
          }
          dens {
            id
            name
            color
          }
          racers {
            id
            firstName
            lastName
            carNumber
            denId
            carPassedInspection
            # ... other fields
          }
        }
        tracks {
          id
          name
        }
      }
      ```

2.  **Migrate Components**
    - **RaceDetails.tsx**: Replace multiple `useEffect` fetches with single `useQuery`.
    - **RacerForm.tsx**: Use `createRacer` and `updateRacer` mutations. Note: Keep file upload as REST for now.
    - **DenManager.tsx**: Use `createDen`, `updateDen`, `deleteDen` mutations.
    - **Bulk Actions**: Use bulk mutations.
    - **CheckInModal.tsx**: Use `checkInRacer` mutation.

3.  **Handle Uploads**
    - Ensure `RacerForm` still uses the REST endpoint for image uploads, but passes the returned URL to the GraphQL mutation.

4.  **Backend Updates (if needed)**
    - Verify `Race` has `dens` and `racers` resolvers (it does).

## Verification

- **Update Tests**: Update `src/pages/RaceDetails.test.tsx` and any component tests (like `RacerForm.test.tsx` if applicable) to mock GraphQL responses instead of REST calls.
- **Run Tests**: Ensure `npm test src/pages/RaceDetails.test.tsx` and related tests pass.
- Verify loading race details (racers, dens).
- Verify adding/editing/deleting racers.
- Verify managing dens.
- Verify bulk actions.
