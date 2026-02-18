# Task 5: Frontend — Integrate Free Race into Race Control [COMPLETED]

## Goal

Add a **"Free Race"** tab to the `RaceControl` page that hosts the `FreeRaceLaneSetup` and `FreeRaceExecution` components. The tab must be clearly labelled so operators know it does not affect standings.

## Files to Modify

- `frontend/src/pages/RaceControl.tsx` — add tab + state management
- `frontend/src/pages/RaceControl.test.tsx` — add integration tests
- `frontend/src/pages/Observation.tsx` — show active free race heat to audience
- `frontend/src/pages/Observation.test.tsx` — add tests for free race heat display

## New Files

- `frontend/src/components/race-control/FreeRaceTab.tsx` — orchestrates the two-phase flow (setup → execution → setup)

---

## FreeRaceTab Component

`frontend/src/components/race-control/FreeRaceTab.tsx`

This component manages the two-phase flow:

```
Phase 1: SETUP   → render <FreeRaceLaneSetup>
Phase 2: RUNNING → render <FreeRaceExecution>
```

### Props

```typescript
interface FreeRaceTabProps {
  raceId: number;
  laneCount: number;
  timerType: string | null;
  racers: Record<number, RacerSummary>;
}
```

### State

```typescript
type FreeRacePhase =
  | { kind: "setup" }
  | { kind: "running"; heatId: number; assignments: LaneAssignment[] };
```

### GraphQL Mutation (called in this component)

```graphql
mutation StartFreeRaceHeat(
  $raceId: Int!
  $laneAssignments: [FreeRaceLaneAssignmentInput!]!
) {
  startFreeRaceHeat(raceId: $raceId, laneAssignments: $laneAssignments) {
    id
    laneAssignments
  }
}
```

Called when `FreeRaceLaneSetup` fires `onStart`. On success, transition to `running` phase with the returned `heatId`.

---

## Changes to `RaceControl.tsx`

### 1. Add a "Free Race" tab

The existing `RaceControl` page has tabs for **Schedule** and **Race**. Add a third tab:

```
[📋 Schedule]  [🏎️ Race]  [🏁 Free Race]
```

The tab label should include a small badge or subtitle: _"Practice / Exhibition"_.

### 2. Render `<FreeRaceTab>` when active

When the "Free Race" tab is selected, render:

```tsx
<FreeRaceTab
  raceId={raceId}
  laneCount={track?.laneCount ?? 4}
  timerType={track?.timerType ?? null}
  racers={racersById}
/>
```

Where `racersById` is the existing racer map already computed in `RaceControl`.

### 3. No changes to existing tab logic

The Free Race tab is completely independent. Switching to it does not affect the Schedule or Race tabs.

---

## Changes to `Observation.tsx`

The Observation page is the audience-facing kiosk/display. It must show Free Race heats in the **"Now Racing"** panel so the audience can follow along during exhibition heats.

### GraphQL Query Update

Add `activeFreeRaceHeat` to the existing `GET_OBSERVATION_DATA` query:

```graphql
query GetObservationData($id: Int!) {
  race(raceId: $id) {
    id
    heats { ... }        # existing
    racers { ... }       # existing
    leaderboard { ... }  # existing
  }
  activeFreeRaceHeat(raceId: $id) {
    id
    laneAssignments   # JSON
    laneResults       # JSON, null if heat is still running
    createdAt
  }
}
```

### Priority Logic

The "Now Racing" panel should use the following priority:

1. **Official heat in progress** (existing logic: first uncompleted `Heat` from the schedule) — shown as-is, no change.
2. **Active Free Race heat** (`activeFreeRaceHeat` is non-null and `laneResults` is null) — shown when no official heat is currently running.
3. **Nothing** — show "No heat scheduled" as before.

```typescript
// Pseudocode for the priority decision
const officialCurrentHeat = uncompleted[0] ?? null;
const freeRaceIsActive = activeFreeRaceHeat && !activeFreeRaceHeat.laneResults;

const nowRacingHeat =
  officialCurrentHeat ?? (freeRaceIsActive ? activeFreeRaceHeat : null);
const nowRacingIsExhibition = !officialCurrentHeat && freeRaceIsActive;
```

### Exhibition Badge

When the "Now Racing" card is showing a Free Race heat, render a visible **"Exhibition"** badge inside the card header so the audience knows it is not an official heat:

```tsx
{
  nowRacingIsExhibition && (
    <span
      style={{
        background: "var(--cub-scouting-gold)",
        color: "#333",
        fontSize: "0.75rem",
        fontWeight: "bold",
        padding: "2px 8px",
        borderRadius: "12px",
        marginLeft: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      Exhibition
    </span>
  );
}
```

The **Live Standings** table is unchanged — it always reflects only official results.

### `Observation.test.tsx` additions

Add to the existing test file:

- When `activeFreeRaceHeat` is non-null and `laneResults` is null, and no official heat is in progress, the "Now Racing" card shows the free race lane assignments.
- The "Exhibition" badge is rendered in that case.
- When an official heat is also in progress, the official heat takes priority and the Exhibition badge is NOT shown.
- When `activeFreeRaceHeat` has `laneResults` (heat is complete), it is NOT shown in "Now Racing".
- Live Standings table is unaffected in all cases.

---

## Tests

### `FreeRaceTab.test.tsx`

File: `frontend/src/components/race-control/FreeRaceTab.test.tsx`

Cover:

- Renders `FreeRaceLaneSetup` in setup phase.
- Calls `startFreeRaceHeat` mutation when `onStart` fires.
- Transitions to `FreeRaceExecution` after mutation succeeds.
- Transitions back to `FreeRaceLaneSetup` when `onRunAnother` fires.
- Shows an error message if `startFreeRaceHeat` mutation fails.

### `RaceControl.test.tsx` additions

Add to the existing test file:

- "Free Race" tab is rendered in the tab bar.
- Clicking "Free Race" tab renders `FreeRaceTab`.
- Switching back to "Schedule" tab renders `ScheduleManagement`.

---

## Verification

```bash
cd /home/dknowles/src/trusty-track/frontend
npm test src/components/race-control/FreeRaceTab.test.tsx
npm test src/pages/RaceControl.test.tsx
npm test src/pages/Observation.test.tsx
```

Run the full frontend test suite to check for regressions:

```bash
npm test
```
