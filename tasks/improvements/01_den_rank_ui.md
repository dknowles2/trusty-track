# Task: Den Rank Assignment in UI

## Goal

Expose the `rank` field on `Den` in the frontend so operators can assign a Cub Scout rank (Lion, Tiger, Wolf, Bear, Webelos, Arrow of Light) to each den.

## Background

The backend `Den` model in `models.py` already has a `rank` field:
```python
rank: Mapped[Optional[Rank]] = mapped_column(SAEnum(Rank), default=Rank.OTHER, nullable=True)
```

The `Rank` enum supports: `LION`, `TIGER`, `WOLF`, `BEAR`, `WEBELOS`, `ARROW_OF_LIGHT`, `OTHER`.

SPEC.md states:
> "If Cub Scouts, then each group is likely a 'Den', and each 'Den' should also be assigned a 'rank' which can be used later for branding."

The `DenManager.tsx` component currently lets operators set den name and color but does not expose the rank field.

## Steps

### Backend

1. **Verify GraphQL exposes `rank`** on the `Den` type in `backend/graphql.py`.
   - The `DenType` should include a `rank` field.
   - The `create_den` and `update_den` mutations should accept `rank` as an optional argument.
   - If not already present, add them.

### Frontend

2. **Add rank selector to `DenManager.tsx`**:
   - Add a dropdown for `rank` in the den creation/edit form.
   - Options: "Other / Not specified", "Lion", "Tiger", "Wolf", "Bear", "Webelos", "Arrow of Light"
   - Map display names to enum values: `OTHER`, `LION`, `TIGER`, `WOLF`, `BEAR`, `WEBELOS`, `ARROW_OF_LIGHT`

3. **Display rank in the den list**:
   - Show the rank as a badge or label next to each den name in the den list.

4. **Update GraphQL query/mutation** in `src/graphql/raceDetails.ts`:
   - Include `rank` in the `GetRaceDetails` query for dens.
   - Include `rank` in `CreateDen` and `UpdateDen` mutation inputs.

5. **Use rank for branding** (stretch goal):
   - In `Observation.tsx` and `Leaderboard.tsx`, when a racer's den has a rank, display the rank name alongside the den name or as a label.

## Verification

- Create a den and assign a rank. Verify the rank is saved and displayed.
- Edit an existing den's rank. Verify the change persists.
- Run backend tests: `pytest backend/`.
- Run frontend tests: `npm test`.
