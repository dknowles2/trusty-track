# Task 4: Migrate Race Control

## Goal

Migrate `src/pages/RaceControl.tsx` and its sub-components to use GraphQL.

## Steps

1.  **Define Queries**
    - Fetch Race Schedule:
      ```graphql
      query GetRaceSchedule($raceId: Int!) {
        race(raceId: $raceId) {
          rounds {
            id
            roundNumber
            name
            heats {
              id
              heatNumber
              laneResults # JSON string
            }
          }
        }
      }
      ```
    - **Backend Update**: Ensure `Round` and `Heat` are exposed in GraphQL.

2.  **Migrate Mutations**
    - **Wizard**: Use `createRaceWizard` mutation.
    - **Rounds**: Use `regenerateRound`, `deleteRound`, `advanceRound`.
    - **Heats**: Use `updateHeatResult`.

3.  **Refactor Components**
    - `RaceControl.tsx`: Manage state with GraphQL subscriptions or polling (or just refetching for now).
    - `ScheduleManagement.tsx`: Update handlers to use mutations.
    - `RaceExecution.tsx`: Update result submission to use mutation.

## Verification

- **Update Tests**: Update `src/pages/RaceControl.test.tsx` and related component tests (`RoundWizard.test.tsx`, `ScheduleManagement.test.tsx`) to mock GraphQL responses.
- **Run Tests**: Ensure `npm test src/pages/RaceControl.test.tsx` passes.
- Verify generating a schedule via wizard.
- Verify running a heat and saving results.
- Verify advancement logic.
