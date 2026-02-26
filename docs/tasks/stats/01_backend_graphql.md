# Task 1: Backend — Stats Module & GraphQL Query

## Goal

Add a `race_stats(raceId)` GraphQL query that returns comprehensive race statistics. Computation lives in a new `backend/stats.py` module. Strawberry types are added to `backend/schema.py`.

## Background

All data needed for stats is already present in the database (`Heat.lane_results`, `Racer`, `Den`, `Round` tables). This task is purely additive — no schema migrations or changes to existing models.

The DNF penalty (`t_val <= 0.0 → 9.999`) is copied from `scoring.py` to ensure consistent treatment across all race analytics.

---

## Steps

### 1. Create `backend/stats.py`

New module with the following functions. Follow the conventions in `scoring.py` exactly (imports, Session usage, json.loads for lane_results).

#### Constants & helpers

```python
import json
import math
from collections import defaultdict
from typing import Optional

from sqlalchemy.orm import Session

from . import crud, models

DNF_PENALTY = 9.999  # matches scoring.py


def _normalize_time(t) -> Optional[float]:
    """Convert a raw time value to a usable float, applying the DNF penalty."""
    if t is None:
        return None
    try:
        v = float(t)
        return DNF_PENALTY if v <= 0.0 else v
    except (ValueError, TypeError):
        return None
```

#### `_compute_lane_stats(all_results, lane_count) → list[dict]`

Groups **non-DNF** times by lane number. For each lane 1..lane_count:
- `avg_time`: mean of non-DNF times for that lane (`None` if no data)
- `heat_count`: number of individual racer results in that lane
- `relative_advantage_pct`: `(overall_avg - lane_avg) / overall_avg * 100`
  - Positive = faster than average (favorable lane)
  - Negative = slower than average (unfavorable lane)
  - `None` if lane has no data

`overall_avg` is computed across all lanes (non-DNF times only).

#### `_compute_racer_stats(all_results, racer_heat_counts, racer_map, den_map) → list[dict]`

Groups normalized times by `racer_id`. For each racer:
- `heats_completed`: number of results with a recorded time (including DNF)
- `heats_scheduled`: from `racer_heat_counts` (count of appearances in any heat's lane_results)
- `min_time`, `max_time`, `mean_time`: computed over non-DNF times (`None` if no data)
- `std_dev`: population std dev of non-DNF times; `None` if fewer than 2 data points
- `times_per_lane`: list of `{lane, avg_time}` dicts for lanes the racer ran in
- `_den_id`: internal int (not exposed in GraphQL type) used by `_compute_den_stats`

Sorted by `mean_time` ascending (racers with `None` last).

**Computing `racer_heat_counts`** (done in `compute_race_stats`):
Iterate all heats (completed or not) and count how many times each `racer_id` appears in `lane_results`. This gives scheduled heat count per racer.

#### `_compute_highlights(heats_with_rounds, racer_map) → list[dict]`

Iterates completed heats (those with at least one non-None time in `lane_results`) to find:

- `FASTEST_HEAT`: the single non-DNF time that is the minimum across all heats. Captures `round_name`, `heat_number`, `time`, and `racer_name` of the racer who ran that time.
- `CLOSEST_RACE`: the heat with the smallest margin between best and worst non-DNF time in that heat. Captures `round_name`, `heat_number`, `margin`.

`heats_with_rounds` is a list of `(heat_obj, round_name_str)` tuples, built in `compute_race_stats`.

#### `_compute_den_stats(racer_stats, dens) → list[dict]`

Groups `racer_stats` dicts by their `_den_id`. For each den:
- `den_id`, `den_name`, `den_color`: from the `Den` model
- `racer_count`: number of racers in that den (from `Den.racers` or filtered racer list)
- `avg_score`: mean of `mean_time` across all den members who have results (`None` if none)
- `best_racer_name`: full name of den member with lowest `mean_time`

Sorted by `avg_score` ascending (dens with no results last).

#### `_compute_heat_results(heats_with_rounds, racer_map) → list[dict]`

Flat list of every lane entry across all completed heats, for use in CSV export:
- `round_name`, `heat_number`, `lane`
- `car_number`, `racer_first_name`, `racer_last_name`
- `time` (normalized, `None` for empty lanes), `place`

Ordered by `(round_name, heat_number, lane)`.

#### `compute_race_stats(db, race_id) → dict | None`

Top-level entry point called from the GraphQL resolver:

```python
def compute_race_stats(db: Session, race_id: int):
    race = crud.get_race(db, race_id)
    if not race:
        return None

    heats = crud.get_heats(db, race_id)
    rounds = crud.get_rounds(db, race_id)
    round_map = {r.id: r for r in rounds}
    dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
    racers = crud.get_racers(db, race_id=race_id)
    racer_map = {r.id: r for r in racers}
    den_map = {d.id: d for d in dens}
    lane_count = race.track.lane_count if race.track else 4

    # Build flat results list + scheduled heat counts
    all_results = []
    racer_heat_counts = defaultdict(int)
    heats_with_rounds = []

    for heat in heats:
        if not heat.lane_results:
            continue
        results = json.loads(heat.lane_results)
        for r in results:
            if r.get("racer_id"):
                racer_heat_counts[r["racer_id"]] += 1
        has_times = any(r.get("time") is not None for r in results if r.get("racer_id"))
        if has_times:
            all_results.extend(results)
            rnd_name = round_map[heat.round_id].name if heat.round_id in round_map else "Round"
            heats_with_rounds.append((heat, rnd_name))

    lane_stats = _compute_lane_stats(all_results, lane_count)
    racer_stats = _compute_racer_stats(all_results, racer_heat_counts, racer_map, den_map)
    highlights = _compute_highlights(heats_with_rounds, racer_map)
    den_stats = _compute_den_stats(racer_stats, dens)
    heat_results = _compute_heat_results(heats_with_rounds, racer_map)

    return {
        "race_id": race.id,
        "race_name": race.name,
        "scoring_strategy": race.scoring_strategy.value,
        "total_heats_scheduled": len(heats),
        "total_heats_completed": len(heats_with_rounds),
        "total_racers": len(racers),
        "lane_stats": lane_stats,
        "racer_stats": racer_stats,
        "highlights": highlights,
        "den_stats": den_stats,
        "heat_results": heat_results,
    }
```

---

### 2. Add Strawberry types to `backend/schema.py`

Add the following types near the `LeaderboardEntry` type definition. All fields match the dict keys returned by `stats.py`.

```python
@strawberry.type
class TimesPerLane:
    lane: int
    avg_time: Optional[float]

@strawberry.type
class RacerStat:
    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_name: str
    heats_completed: int
    heats_scheduled: int
    min_time: Optional[float]
    max_time: Optional[float]
    mean_time: Optional[float]
    std_dev: Optional[float]
    times_per_lane: List[TimesPerLane]

@strawberry.type
class LaneTimeStat:
    lane: int
    avg_time: Optional[float]
    heat_count: int
    relative_advantage_pct: Optional[float]

@strawberry.type
class HeatHighlight:
    type: str          # "FASTEST_HEAT" | "CLOSEST_RACE"
    round_name: str
    heat_number: int
    racer_name: Optional[str]
    time: Optional[float]
    margin: Optional[float]

@strawberry.type
class DenStat:
    den_id: int
    den_name: str
    den_color: str
    racer_count: int
    avg_score: Optional[float]
    best_racer_name: Optional[str]

@strawberry.type
class HeatResultRow:
    round_name: str
    heat_number: int
    lane: int
    car_number: Optional[int]
    racer_first_name: str
    racer_last_name: str
    time: Optional[float]
    place: Optional[int]

@strawberry.type
class RaceStats:
    race_id: int
    race_name: str
    scoring_strategy: str
    total_heats_scheduled: int
    total_heats_completed: int
    total_racers: int
    lane_stats: List[LaneTimeStat]
    racer_stats: List[RacerStat]
    highlights: List[HeatHighlight]
    den_stats: List[DenStat]
    heat_results: List[HeatResultRow]
```

Add the resolver to the `Query` class:

```python
@strawberry.field
def race_stats(self, info: Info, race_id: int) -> Optional[RaceStats]:
    from . import stats as race_stats_module
    db = info.context["db"]
    return race_stats_module.compute_race_stats(db, race_id)
```

Note: Strawberry will auto-convert snake_case dict keys to camelCase for the GraphQL schema (e.g., `race_id` → `raceId`). The dict keys in `stats.py` must match the snake_case field names of the Strawberry types.

---

### 3. Write `backend/test_race_stats.py`

Follow the pattern in existing `test_*.py` files (TestClient + in-memory SQLite, GraphQL requests via POST to `/graphql`).

**Test setup**: Create a group, track (4 lanes), race, 2 dens, 4 racers (2 per den). Generate a round with heats via `createRoundWizard`. Record heat results via `updateHeatResult` mutation — ensure at least one full heat is completed per lane.

**Assertions**:
- `totalHeatsCompleted` matches the number of heats with recorded times
- `laneStats` has 4 entries (one per lane); `heatCount` > 0 for all lanes
- `racerStats` returns all 4 racers; each has non-null `meanTime`, `minTime`, `maxTime`
- `racerStats[0].stdDev` is non-null (racer raced at least twice)
- `highlights` contains at least one entry with `type == "FASTEST_HEAT"`
- `denStats` has 2 entries (one per den); `avgScore` is non-null for both
- `heatResults` row count equals (heats_completed × lane_count)

---

## Files Modified

| File | Change |
| ---- | ------ |
| `backend/stats.py` | New — all stats computation |
| `backend/schema.py` | Add 7 Strawberry types + `race_stats` query resolver to `Query` class |
| `backend/test_race_stats.py` | New — pytest tests |

## Verification

```bash
cd backend && pytest test_race_stats.py -v
# Then run full suite for regressions:
cd backend && pytest -v
```

Start the dev server and run a GraphQL introspection to verify the new types appear:

```bash
cd backend && uvicorn main:app --reload
# In another terminal:
curl -s -X POST http://localhost:8000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ raceStats(raceId: 1) { raceName totalHeatsCompleted } }"}' | jq .
```
