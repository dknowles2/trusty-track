# Task 2: Frontend — Stats Page [COMPLETED]

> **Built.** `frontend/src/features/stats/pages/RaceStats.tsx`.

## Goal

Create a new `RaceStats` page at `/race/:raceId/stats` that displays the statistics computed by Task 1's `race_stats` query. The page live-updates via subscription, includes bar charts (recharts), and offers CSV export.

## Background

This task depends on Task 1 (`01_backend_graphql.md`) being complete — the `GET_RACE_STATS` query must resolve correctly before the frontend can be built.

The page follows the same patterns as `Standings.tsx` + `Leaderboard.tsx`:
- `useQuery` with `requestPolicy: 'cache-and-network'`
- `useSubscription(RACE_STATE_CHANGED_SUBSCRIPTION)` triggers `reExecute({ requestPolicy: 'network-only' })`
- CSS custom properties for theme colors

---

## Steps

### 1. Install `recharts`

```bash
cd frontend && npm install recharts
```

recharts ships its own TypeScript types; no `@types/recharts` package is needed.

### 2. Add `GET_RACE_STATS` to `frontend/src/graphql/raceDetails.ts`

```typescript
export const GET_RACE_STATS = gql`
  query GetRaceStats($raceId: Int!) {
    raceStats(raceId: $raceId) {
      raceId
      raceName
      scoringStrategy
      totalHeatsScheduled
      totalHeatsCompleted
      totalRacers

      laneStats {
        lane
        avgTime
        heatCount
        relativeAdvantagePct
      }

      racerStats {
        racerId
        firstName
        lastName
        carNumber
        denName
        heatsCompleted
        heatsScheduled
        minTime
        maxTime
        meanTime
        stdDev
        timesPerLane {
          lane
          avgTime
        }
      }

      highlights {
        type
        roundName
        heatNumber
        racerName
        time
        margin
      }

      denStats {
        denId
        denName
        denColor
        racerCount
        avgScore
        bestRacerName
      }

      heatResults {
        roundName
        heatNumber
        lane
        carNumber
        racerFirstName
        racerLastName
        time
        place
      }
    }
  }
`;
```

Also ensure `RACE_STATE_CHANGED_SUBSCRIPTION` is exported from `raceDetails.ts` (check if it's currently defined inline in `Leaderboard.tsx` or `RaceControl.tsx` and move/export if needed).

### 3. Create `frontend/src/pages/RaceStats.tsx`

#### Live update wiring (mirrors `Leaderboard.tsx` exactly)

```tsx
const { raceId } = useParams<{ raceId: string }>();
const id = parseInt(raceId!);

const [result, reExecute] = useQuery({
  query: GET_RACE_STATS,
  variables: { raceId: id },
  requestPolicy: 'cache-and-network',
});

useSubscription(
  {
    query: RACE_STATE_CHANGED_SUBSCRIPTION,
    variables: { raceId: id },
    pause: !id || isNaN(id),
  },
  (_prev, data) => {
    reExecute({ requestPolicy: 'network-only' });
    return data;
  }
);

const stats = result.data?.raceStats;
```

#### Page sections

The page is a single scrolling column of section cards. Each section is a `<div className="stats-section">`.

---

**Section 1 — Overview**

Four stat pills in a row:
- Race name (large, page heading)
- Scoring strategy badge (`TIMED` or `POINTS`)
- "X / Y heats completed"
- "N racers"

No charts. Plain text/badge display.

---

**Section 2 — Lane Fairness**

Header: "Lane Fairness"

A `BarChart` from recharts showing `relativeAdvantagePct` per lane:

```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer
} from 'recharts';

<ResponsiveContainer width="100%" height={220}>
  <BarChart data={stats.laneStats} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
    <CartesianGrid strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="lane" tickFormatter={(v) => `Lane ${v}`} />
    <YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} />
    <Tooltip formatter={(val: number) => [`${val.toFixed(2)}%`, 'Advantage']} />
    <ReferenceLine y={0} stroke="#999" strokeDasharray="4 2" />
    <Bar dataKey="relativeAdvantagePct" name="Advantage" radius={[4, 4, 0, 0]}>
      {stats.laneStats.map((entry) => (
        <Cell
          key={entry.lane}
          fill={
            entry.relativeAdvantagePct == null ? '#ccc'
            : entry.relativeAdvantagePct >= 0 ? 'var(--scouting-blue)'
            : 'var(--gold)'
          }
        />
      ))}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

Sign convention: positive = faster than average = favorable = blue. Negative = slower = gold/warning.

Below the chart: a plain table — Lane | Avg Time | Heats | Advantage.

---

**Section 3 — Per-Racer Stats**

Header: "Racer Statistics"

Sortable table. Local state:
```tsx
const [sortKey, setSortKey] = useState<keyof RacerStat>('meanTime');
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
```

Columns: `#` (car number) | Name | Den | Heats | Min | Avg | Max | Consistency (std dev).

Clicking a column header toggles sort direction on that column. Rows with `null` values sort last.

Time columns formatted as `3.452s` for TIMED strategy, plain number for POINTS.

Consistency column: show std dev in seconds (e.g. `0.0312s`). Lower is better. A tooltip or footnote can explain.

---

**Section 4 — Top Moments**

Header: "Top Moments"

Render one card per highlight from `stats.highlights`:

- `FASTEST_HEAT`: "Fastest Heat — {racerName}, {time}s in {roundName} Heat {heatNumber}"
- `CLOSEST_RACE`: "Closest Race — margin of {margin}s in {roundName} Heat {heatNumber}"

Cards displayed in a horizontal row (flex wrap). Each card has a colored left border (blue for fastest, gold for closest).

If `highlights` is empty, show a muted "No completed heats yet" message.

---

**Section 5 — Den Comparison**

Header: "Den Comparison"

Horizontal bar chart (`layout="vertical"`) showing `avgScore` per den. Each bar is colored using `entry.denColor`:

```tsx
<ResponsiveContainer width="100%" height={Math.max(120, stats.denStats.length * 50)}>
  <BarChart data={stats.denStats} layout="vertical" margin={{ left: 16, right: 32 }}>
    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
    <XAxis type="number" tickFormatter={(v) => `${v.toFixed(3)}s`} />
    <YAxis type="category" dataKey="denName" width={90} />
    <Tooltip formatter={(val: number) => [`${val.toFixed(3)}s`, 'Avg Score']} />
    <Bar dataKey="avgScore" name="Avg Score" radius={[0, 4, 4, 0]}>
      {stats.denStats.map((entry) => (
        <Cell key={entry.denId} fill={entry.denColor || 'var(--scouting-blue)'} />
      ))}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

Below the chart: a table — Den | Racers | Avg Score | Best Racer.

---

**Section 6 — CSV Export**

Header: "Export Data"

Two buttons side by side:
- "Download Heat Results" — triggers `exportHeatResultsCsv(stats)`
- "Download Racer Stats" — triggers `exportRacerStatsCsv(stats)`

Both are client-side only (no network call). Helper functions in the component file (or `frontend/src/utils/csvExport.ts` if reuse is anticipated):

```typescript
function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const csv = rows
    .map(row => row.map(cell => `"${cell ?? ''}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportHeatResultsCsv(stats: RaceStatsData) {
  const header = ['Round', 'Heat #', 'Lane', 'Car #', 'First Name', 'Last Name', 'Time (s)', 'Place'];
  const rows = stats.heatResults.map(r => [
    r.roundName, r.heatNumber, r.lane,
    r.carNumber ?? '', r.racerFirstName, r.racerLastName,
    r.time?.toFixed(3) ?? 'DNF', r.place ?? ''
  ]);
  downloadCsv(`heat-results-race-${stats.raceId}.csv`, [header, ...rows]);
}

function exportRacerStatsCsv(stats: RaceStatsData) {
  const header = ['Car #', 'First Name', 'Last Name', 'Den', 'Heats', 'Min (s)', 'Avg (s)', 'Max (s)', 'Std Dev'];
  const rows = stats.racerStats.map(r => [
    r.carNumber ?? '', r.firstName, r.lastName, r.denName,
    r.heatsCompleted,
    r.minTime?.toFixed(3) ?? '',
    r.meanTime?.toFixed(3) ?? '',
    r.maxTime?.toFixed(3) ?? '',
    r.stdDev?.toFixed(4) ?? ''
  ]);
  downloadCsv(`racer-stats-race-${stats.raceId}.csv`, [header, ...rows]);
}
```

---

### 4. Create `frontend/src/pages/RaceStats.css`

Root class `.race-stats`. Follow the visual style of existing pages.

Key styles:

```css
.race-stats {
  max-width: 960px;
  margin: 2rem auto;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.stats-section {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.stats-section h2 {
  font-size: 1rem;
  font-weight: bold;
  color: var(--scouting-blue);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin: 0 0 1rem 0;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.stats-table th {
  background: var(--scouting-blue);
  color: white;
  padding: 0.5rem 0.75rem;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.stats-table th:hover {
  background: #002d6b;
}

.stats-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #f0f0f0;
}

.stats-table tr:last-child td {
  border-bottom: none;
}

.overview-pills {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

.overview-pill {
  background: #f0f7ff;
  color: var(--scouting-blue);
  border-radius: 20px;
  padding: 0.3rem 0.9rem;
  font-size: 0.85rem;
  font-weight: bold;
}

.highlight-cards {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.highlight-card {
  flex: 1;
  min-width: 200px;
  padding: 1rem;
  border-radius: 8px;
  border-left: 4px solid var(--scouting-blue);
  background: #f9f9f9;
}

.highlight-card.closest {
  border-left-color: var(--gold);
}

.export-buttons {
  display: flex;
  gap: 1rem;
}

.export-btn {
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  border: none;
  background: var(--scouting-blue);
  color: white;
  font-weight: bold;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s;
}

.export-btn:hover {
  background: #002d6b;
}
```

### 5. Add route to `frontend/src/App.tsx`

Add import at top (with other page imports):
```tsx
import RaceStats from './pages/RaceStats';
```

Add route after the `/race/:raceId/standings` route:
```tsx
<Route path="/race/:raceId/stats" element={<ProtectedRoute><RaceStats /></ProtectedRoute>} />
```

### 6. Add nav link to `frontend/src/components/Navigation.tsx`

Add `mdiChartBar` to the MDI icon import (line 9):
```tsx
import { ..., mdiChartBar } from '@mdi/js';
```

Push to the `links` array (after the `mdiVideo` / Live link):
```tsx
{ to: `/race/${raceId}/stats`, label: 'Stats', icon: mdiChartBar },
```

This single change handles both the desktop secondary header and the mobile drawer, since both render from the same `links` array.

---

## Files Modified / Created

| File | Change |
| ---- | ------ |
| `frontend/package.json` | Add `recharts` dependency |
| `frontend/src/graphql/raceDetails.ts` | Add `GET_RACE_STATS` gql string; ensure `RACE_STATE_CHANGED_SUBSCRIPTION` is exported |
| `frontend/src/pages/RaceStats.tsx` | New — full stats page component |
| `frontend/src/pages/RaceStats.css` | New — page styles |
| `frontend/src/App.tsx` | Add import + 1 route |
| `frontend/src/components/Navigation.tsx` | Add `mdiChartBar` import + 1 link entry |

## Verification

```bash
cd frontend && npm run build   # must pass with no TypeScript errors
```

1. Start dev server (`./scripts/run_dev.sh`)
2. Navigate to a race with at least one completed heat → `/race/:id/stats`
3. Verify all 5 sections render with correct data
4. Record a new heat result in Race Control → stats page auto-updates within 1–2 seconds
5. Click "Download Heat Results" → CSV downloads with correct columns
6. Click "Download Racer Stats" → CSV downloads with correct columns
7. Resize to mobile width → Stats link visible in hamburger drawer
8. Navigate to `/race/:id/stats` on a race with zero heats → page renders gracefully (no crashes, "no data" states shown)
