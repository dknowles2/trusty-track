# Free Race Mode — Overview

## What Is Free Race Mode?

**Free Race** is an informal, non-competitive race mode that does **not** affect official standings or the leaderboard. It is intended for:

- **Practice runs** before the official race begins.
- **Exhibition heats** (e.g., parent/sibling cars, special guests).
- **Testing the timer** and track hardware without polluting real data.
- **Fun heats** run at the end of an event.

A Free Race heat is ephemeral: results are displayed in real-time but are never written to the official `Heat` or `Round` tables and never affect the `leaderboard`.

---

## Key Design Decisions

### 1. Lane Population

The operator has two options for filling lanes:

| Mode       | Description                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Random** | The system randomly selects N racers from the checked-in roster (where N = track lane count). Operator can re-shuffle before starting. |
| **Manual** | The operator picks a racer for each lane from a dropdown. Lanes may be left empty (empty lane = no racer).                             |

### 2. No Standings Impact

Free Race results are stored in a **separate, transient table** (`free_race_heats`) that is explicitly excluded from all scoring and leaderboard queries. The table is lightweight and can be cleared at any time.

### 3. Entry Point

Free Race is accessible from the **Race Control** page via a dedicated "Free Race" tab or button, clearly labelled so operators know it does not affect standings.

### 4. Timer Integration

Free Race reuses the existing timer infrastructure (`FakeTimerMole`, WebSocket timer events) so it works with both the fake timer and real hardware.

---

## Task Breakdown

| Task | File                         | Description                                            |
| ---- | ---------------------------- | ------------------------------------------------------ |
| 1    | `01_backend_model.md`        | Add `FreeRaceHeat` model and DB migration              |
| 2    | `02_backend_graphql.md`      | Add GraphQL types, queries, and mutations              |
| 3    | `03_frontend_lane_setup.md`  | `FreeRaceLaneSetup` component (random + manual)        |
| 4    | `04_frontend_execution.md`   | `FreeRaceExecution` component (run heat, show results) |
| 5    | `05_frontend_integration.md` | Integrate into Race Control page                       |

---

## Data Flow

```
Operator opens Free Race tab
        │
        ▼
FreeRaceLaneSetup
  ├── "Random" → backend randomizes checked-in racers
  └── "Manual" → operator picks racer per lane
        │
        ▼
Operator clicks "Start Free Race Heat"
        │
        ├──────────────────────────────────────────┐
        ▼                                          ▼
FreeRaceExecution                        Observation page (audience)
  ├── Timer fires (fake or real)           ├── "Now Racing (Exhibition)" panel
  ├── Results displayed in-page            │    shows active free race heat
  └── Results saved to free_race_heats     └── Polls every 5s (same as normal)
        │
        ▼
"Run Another" → back to FreeRaceLaneSetup
```

> **Note**: The Observation page shows Free Race heats in the "Now Racing" panel
> with a clear **"Exhibition"** label so the audience knows results are informal.
> The **Live Standings** table is never affected — it always reflects only
> official race results.

---

## Out of Scope

- Free Race results do NOT appear in the Leaderboard or Standings pages.
- Free Race heats are NOT included in the Round Wizard or schedule.
- Free Race does NOT advance racers to championship rounds.

## In Scope (Observation)

- The **Observation page** (audience kiosk/display) **does** show the active Free Race heat in its "Now Racing" panel, labelled as "Exhibition".
- When a Free Race heat is active and no official heat is currently running, the Observation page shows the Free Race heat instead.
- When both an official heat and a Free Race heat are active simultaneously, the official heat takes priority in the "Now Racing" slot.
