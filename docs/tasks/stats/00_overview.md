# Race Statistics — Overview [COMPLETED]

> **Built.** `services/stats.py`, the `raceStats` query, and
> `features/stats/pages/RaceStats.tsx` at `/race/:raceId/stats`.

## What Is the Stats Page?

The **Stats page** is a dedicated view for post-race analysis of a Pinewood Derby event. It surfaces aggregated statistics that go beyond the simple leaderboard, giving pack leaders, parents, and race officials a richer picture of how the event went.

The page live-updates as heats are recorded (same subscription pattern as the Leaderboard), so it can also be used mid-race for in-progress analysis.

---

## Key Features

| Section | Description |
| ------- | ----------- |
| **Overview** | Race name, scoring strategy, heats completed vs. scheduled, total racers |
| **Lane Fairness** | Average time per lane, relative advantage/disadvantage vs. overall average, heat count per lane |
| **Per-Racer Stats** | Min / mean / max time, std dev (consistency), heats completed, per-lane breakdown — sortable table |
| **Top Moments** | Fastest single-heat time, closest race (smallest margin between 1st and last) |
| **Den Comparison** | Average score per den, best racer per den — bar chart + table |
| **CSV Export** | Download heat results or racer stats as `.csv` files |

---

## Design Decisions

### Stats are computed server-side
A new `race_stats(raceId)` GraphQL query is added. Computation lives in a new `backend/stats.py` module (separate from `scoring.py` to keep concerns clear). The frontend fetches the result and renders it — no stats logic in React.

### Live updates via subscription
The page subscribes to `RACE_STATE_CHANGED_SUBSCRIPTION` and re-executes the stats query on each event. This is identical to how `Leaderboard.tsx` works — no new subscription infrastructure needed.

### Charts use recharts
`recharts` (a React-native D3 wrapper) is added as a frontend dependency. Used for the lane fairness bar chart and den comparison bar chart. Tables are used elsewhere to stay consistent with the existing UI.

### CSV export is client-side
Heat result and racer stat CSVs are generated entirely in the browser from the data already fetched by `GET_RACE_STATS`. No new backend endpoint needed.

### DNF handling
Times of `0.0` or less are treated as `9.999` (the DNF penalty) — identical to `scoring.py`. DNF times are excluded from min/max display but included in counts.

---

## Task Breakdown

| Task | File | Description |
| ---- | ---- | ----------- |
| 1 | `01_backend_graphql.md` | New `stats.py` module, Strawberry types, `race_stats` query, backend tests |
| 2 | `02_frontend_page.md` | `RaceStats.tsx` + `RaceStats.css`, recharts, routing, navigation |

---

## Data Flow

```
User navigates to /race/:raceId/stats
        │
        ▼
RaceStats.tsx
  ├── useQuery(GET_RACE_STATS) → backend race_stats() → stats.py computation
  │     ├── Lane fairness (avg time per lane, advantage %)
  │     ├── Per-racer stats (min/mean/max/std dev)
  │     ├── Top moments (fastest heat, closest race)
  │     ├── Den comparison (avg score per den)
  │     └── Heat results rows (for CSV export)
  │
  └── useSubscription(RACE_STATE_CHANGED_SUBSCRIPTION)
        └── On event: reExecute({ requestPolicy: 'network-only' })
```

---

## Out of Scope

- Google Sheets export (post-MVP)
- Pack record tracking across multiple events
- Per-round stats breakdown (future: could compare prelims vs. championship)
- Free Race heats are **excluded** from all stats (same as leaderboard)
