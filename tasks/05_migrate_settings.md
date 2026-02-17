# Task 5: Migrate Settings

## Goal

Migrate `src/pages/SystemSettings.tsx` to use GraphQL.

## Steps

1.  **Define Queries**
    - Fetch Initial Config / Tracks.
    - Maybe add a specific root query for `systemSettings` or just use `tracks` and `groups`.

2.  **Migrate Mutations**
    - `createTrack`, `updateTrack`, `deleteTrack`.
    - `updateInitialConfig` (Group name).

3.  **Refactor Component**
    - Replace REST calls with GraphQL hooks.

## Verification

- **Update Tests**: Update `src/pages/SystemSettings.test.tsx` to mock GraphQL responses.
- **Run Tests**: Ensure `npm test src/pages/SystemSettings.test.tsx` passes.
- Verify updating track settings.
- Verify changing group name.
