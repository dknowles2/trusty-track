# Task 3: Frontend — FreeRaceLaneSetup Component [COMPLETED]

## Goal

Create a `FreeRaceLaneSetup` component that lets the operator populate lanes before starting a free race heat. Two sub-modes:

- **Random**: One click randomly assigns checked-in racers to lanes. Operator can re-shuffle.
- **Manual**: Operator picks a racer from a dropdown for each lane. Lanes may be left empty.

## Component Location

`frontend/src/components/race-control/FreeRaceLaneSetup.tsx`

## Props Interface

```typescript
interface FreeRaceLaneSetupProps {
  raceId: number;
  laneCount: number;
  /** Called when the operator is ready to start the heat */
  onStart: (assignments: LaneAssignment[]) => void;
}

export interface LaneAssignment {
  lane: number;
  racerId: number | null; // null = empty lane
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  🏁 Free Race — Lane Setup                          │
│                                                     │
│  [🎲 Random]  [✏️ Manual]          (tab switcher)  │
│                                                     │
│  ── Random Mode ──────────────────────────────────  │
│  Lane 1:  Alex Smith  (#42)                         │
│  Lane 2:  Jordan Lee  (#17)                         │
│  Lane 3:  Sam Rivera  (#5)                          │
│  Lane 4:  (empty)                                   │
│                                                     │
│  [🔀 Re-shuffle]          [▶ Start Free Race Heat]  │
│                                                     │
│  ── Manual Mode ───────────────────────────────── │
│  Lane 1: [▾ Select racer...]                        │
│  Lane 2: [▾ Alex Smith (#42)    ]                   │
│  Lane 3: [▾ Select racer...]                        │
│  Lane 4: [▾ (empty)             ]                   │
│                                                     │
│                         [▶ Start Free Race Heat]    │
└─────────────────────────────────────────────────────┘
```

## GraphQL Operations

### Random mode — query (no side effects)

```graphql
query GetRandomFreeRaceLanes($raceId: Int!) {
  randomFreeRaceLanes(raceId: $raceId) {
    lane
    racerId
  }
}
```

Called on mount (random mode) and on every "Re-shuffle" click.

### Manual mode — query for racer list

```graphql
query GetCheckedInRacers($raceId: Int!) {
  racers(raceId: $raceId) {
    id
    firstName
    lastName
    carNumber
    carPassedInspection
  }
}
```

Filter client-side to `carPassedInspection === true`.

## Implementation Notes

- Use `useQuery` from `urql` for both queries.
- The "Re-shuffle" button in random mode re-executes the `randomFreeRaceLanes` query with `requestPolicy: 'network-only'` to bypass the cache.
- In manual mode, each lane has a `<select>` element. The options list excludes racers already assigned to another lane (to prevent duplicates). An "Empty" option is always available.
- The "Start Free Race Heat" button is disabled if no lanes have a racer assigned.
- Display a clear banner: **"Free Race — results do not affect standings"** in gold/warning style.

## Tests

File: `frontend/src/components/race-control/FreeRaceLaneSetup.test.tsx`

Cover:

- Renders in random mode by default.
- Displays lane assignments returned by the `randomFreeRaceLanes` query.
- "Re-shuffle" button triggers a new query.
- Switching to manual mode shows dropdowns for each lane.
- Manual mode dropdowns exclude already-selected racers.
- "Start Free Race Heat" is disabled when all lanes are empty.
- "Start Free Race Heat" calls `onStart` with correct `LaneAssignment[]`.
- Displays the "results do not affect standings" banner.

## Verification

```bash
cd /home/dknowles/src/trusty-track/frontend
npm test src/components/race-control/FreeRaceLaneSetup.test.tsx
```
