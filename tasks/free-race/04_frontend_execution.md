# Task 4: Frontend — FreeRaceExecution Component [COMPLETED]

## Goal

Create a `FreeRaceExecution` component that runs a free race heat, displays real-time results, and saves them without affecting official standings.

## Component Location

`frontend/src/components/race-control/FreeRaceExecution.tsx`

## Props Interface

```typescript
import { LaneAssignment } from "./FreeRaceLaneSetup";

interface FreeRaceExecutionProps {
  /** The persisted free race heat ID (returned by startFreeRaceHeat mutation) */
  heatId: number;
  /** Lane assignments for this heat */
  laneAssignments: LaneAssignment[];
  /** Map of racer ID → racer details for display */
  racers: Record<
    number,
    {
      id: number;
      firstName: string;
      lastName: string;
      carNumber: number | null;
      racerImageUrl?: string;
    }
  >;
  /** Timer type from track config (e.g. "FAKE") */
  timerType: string | null;
  /** Called when the operator wants to run another free race heat */
  onRunAnother: () => void;
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  🏁 Free Race Heat                                  │
│  ⚠️  Results do not affect standings               │
│                                                     │
│  Lane 1 │ 🧑 Alex Smith  #42  │  3.142s  │  🥇 1st │
│  Lane 2 │ 🧑 Jordan Lee  #17  │  3.287s  │  🥈 2nd │
│  Lane 3 │ 🧑 Sam Rivera  #5   │  3.501s  │  🥉 3rd │
│  Lane 4 │ (empty)             │  ——      │         │
│                                                     │
│  [Waiting for Timer...]   ← before race            │
│  [Racing... 1.4s]         ← during race            │
│  [✏️ Edit]  [🔁 Run Another Free Race Heat]         │
└─────────────────────────────────────────────────────┘
```

## GraphQL Operations

### Mutation: record results

```graphql
mutation RecordFreeRaceResult($heatId: Int!, $results: String!) {
  recordFreeRaceResult(heatId: $heatId, results: $results) {
    id
    laneResults
  }
}
```

Called automatically when the timer fires (via `FakeTimerMole` or real timer event).

### Query: fetch latest results (for display after recording)

The component can use the `laneResults` returned directly from the mutation response rather than re-querying.

## Implementation Notes

- Reuse `FakeTimerMole` from `./FakeTimerMole` for fake timer support (same as `RaceExecution`).
- The component receives `laneAssignments` and renders them immediately. Results are overlaid once the timer fires.
- An **Edit Results** modal (same pattern as `RaceExecution`) lets the operator manually correct times.
- After results are saved, show a "Run Another Free Race Heat" button that calls `onRunAnother()` to reset back to `FreeRaceLaneSetup`.
- Display a persistent **"⚠️ Free Race — results do not affect standings"** warning badge.
- Empty lanes (racer_id = null) show "(empty)" and are excluded from timing/placing.

## Timer Integration

The component accepts a `timerType` prop. When `timerType === 'FAKE'`:

- Render `<FakeTimerMole>` in the same floating-mole pattern as `RaceExecution`.
- On `onTriggerFinish`, call the `recordFreeRaceResult` mutation.

For real timers, the parent (`FreeRaceTab`) will pass timer events down via a callback prop (same pattern as `RaceControl.tsx` does for `RaceExecution`).

## Tests

File: `frontend/src/components/race-control/FreeRaceExecution.test.tsx`

Cover:

- Renders lane assignments with racer names.
- Empty lanes display "(empty)".
- Displays "Waiting for Timer..." before results are recorded.
- Calls `recordFreeRaceResult` mutation when fake timer fires.
- Displays results (time, place) after mutation succeeds.
- "Run Another Free Race Heat" button calls `onRunAnother`.
- Edit modal opens and allows saving corrected times.
- Warning badge "results do not affect standings" is always visible.

## Verification

```bash
cd /home/dknowles/src/trusty-track/frontend
npm test src/components/race-control/FreeRaceExecution.test.tsx
```
