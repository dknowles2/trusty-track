# Task 5: Migrate Settings [COMPLETED]

## Goal

Migrate `src/pages/SystemSettings.tsx` to use GraphQL.

## Steps

1.  **[x] Define Queries**
    - Fetch Initial Config / Tracks.
    - Added `initialConfig` query.

2.  **[x] Migrate Mutations**
    - `createInitialConfig`, `updateInitialConfig`.

3.  **[x] Refactor Component**
    - Replace REST calls with GraphQL hooks.

## Verification

- **[x] Update Tests**: Update `src/pages/SystemSettings.test.tsx` to mock GraphQL responses.
- **[x] Run Tests**: Ensure `npm test src/pages/SystemSettings.test.tsx` passes.
- **[x] Verify updating track settings.**
- **[x] Verify changing group name.**
