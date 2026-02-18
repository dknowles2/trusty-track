# Task 2: Backend — GraphQL Types, Queries & Mutations

## Goal

Expose Free Race functionality through the GraphQL API so the frontend can:

1. Request a random lane assignment.
2. Manually specify lane assignments.
3. Start a free race heat (persist lane assignments).
4. Record results for a free race heat.
5. Query recent free race heats for a race.

## Steps

### 1. Add GraphQL Types to `backend/graphql.py`

```python
@strawberry.type
class FreeRaceHeat:
    """A heat run in Free Race mode. Results do not affect standings."""

    id: int
    race_id: int
    lane_assignments: str   # JSON
    lane_results: Optional[str]  # JSON, null until completed
    created_at: str

    @strawberry.field
    def parsed_assignments(self) -> List[LaneResult]:
        """Parse lane_assignments JSON into LaneResult objects."""
        ...

    @strawberry.field
    def parsed_results(self) -> List[LaneResult]:
        """Parse lane_results JSON into LaneResult objects."""
        ...


@strawberry.input
class FreeRaceLaneAssignmentInput:
    """A single lane assignment for a free race heat."""

    lane: int
    racer_id: Optional[int] = None  # None = empty lane
```

### 2. Add Queries to `Query` class

```python
@strawberry.field
def free_race_heats(
    self, info: Info, race_id: int, limit: int = 10
) -> List[FreeRaceHeat]:
    """Get the most recent free race heats for a race."""
    ...

@strawberry.field
def active_free_race_heat(
    self, info: Info, race_id: int
) -> Optional[FreeRaceHeat]:
    """
    Return the most recently started FreeRaceHeat whose results have not yet
    been recorded (lane_results is null). Returns None if no heat is in
    progress. Used by the Observation page to show exhibition heats.
    """
    ...

@strawberry.field
def random_free_race_lanes(
    self, info: Info, race_id: int
) -> List[FreeRaceLaneAssignmentInput]:
    """
    Return a random lane assignment for the race's track lane count,
    using only checked-in racers. Frontend can display this as a preview
    before the operator commits to starting the heat.
    """
    ...
```

> **Note**: `random_free_race_lanes` is a **query** (not a mutation) because it is
> side-effect-free — it only suggests an assignment without persisting anything.
> The operator can call it multiple times to re-shuffle.

### 3. Add Mutations to `Mutation` class

```python
@strawberry.mutation
def start_free_race_heat(
    self,
    info: Info,
    race_id: int,
    lane_assignments: List[FreeRaceLaneAssignmentInput],
) -> FreeRaceHeat:
    """
    Persist a free race heat with the given lane assignments.
    Returns the created FreeRaceHeat (results will be null until recorded).
    """
    ...

@strawberry.mutation
def record_free_race_result(
    self,
    info: Info,
    heat_id: int,
    results: str,  # JSON string, same shape as lane_assignments + time/place
) -> Optional[FreeRaceHeat]:
    """Record timing results for a free race heat."""
    ...
```

### 4. Wire Up to CRUD

Each resolver delegates to the CRUD helpers added in Task 1:

- `random_free_race_lanes` → `crud.get_random_lane_assignments`
- `start_free_race_heat` → `crud.create_free_race_heat`
- `record_free_race_result` → `crud.update_free_race_heat_result`
- `free_race_heats` → `crud.get_free_race_heats`

### 5. Write Tests in `backend/test_free_race_gql.py`

Cover:

- `randomFreeRaceLanes` query returns correct number of lanes.
- `startFreeRaceHeat` mutation creates a record and returns it.
- `recordFreeRaceResult` mutation updates the record.
- `freeRaceHeats` query returns records for the correct race, newest first.
- Calling `recordFreeRaceResult` with an invalid `heat_id` returns `null`.

## Verification

```bash
cd /home/dknowles/src/trusty-track
pytest backend/test_free_race_gql.py -v
pytest backend/ -v
ruff format backend/graphql.py backend/test_free_race_gql.py
ruff check backend/graphql.py backend/test_free_race_gql.py
mypy backend/graphql.py backend/test_free_race_gql.py
```
