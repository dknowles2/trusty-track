# Task 1: Backend — FreeRaceHeat Model & Migration

## Goal

Add a `FreeRaceHeat` database model to persist free race results separately from official `Heat` records, so they never affect standings or the leaderboard.

## Background

Free Race heats must be stored somewhere so that:

- Results can be displayed in real-time during the heat.
- The operator can review the last few free race results.
- The data is clearly isolated from official race data.

The simplest approach is a new SQLAlchemy model with its own table. Because Alembic is not yet in use, the table will be created via `Base.metadata.create_all()` at startup (same pattern as all other tables).

## Steps

### 1. Add `FreeRaceHeat` to `backend/models.py`

Add the following model after the existing `Heat` class:

```python
class FreeRaceHeat(Base):
    """A single heat run in Free Race mode. Never affects official standings."""

    __tablename__ = "free_race_heats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    # JSON array: [{"lane": 1, "racer_id": 42, "time": 3.141, "place": 1}, ...]
    # racer_id may be None for empty lanes.
    lane_assignments: Mapped[str] = mapped_column(String)
    # JSON array of results, same shape as lane_assignments but with time/place filled in.
    # Null until the heat is completed.
    lane_results: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String)  # ISO-8601 timestamp

    race: Mapped["Race"] = relationship("Race", back_populates="free_race_heats")
```

Also add the back-reference to `Race`:

```python
# In class Race:
free_race_heats: Mapped[List["FreeRaceHeat"]] = relationship(
    "FreeRaceHeat", back_populates="race", cascade="all, delete-orphan"
)
```

### 2. Add CRUD helpers to `backend/crud.py`

Add the following functions:

```python
def create_free_race_heat(
    db: Session,
    race_id: int,
    lane_assignments: list[dict],
) -> models.FreeRaceHeat:
    """Create a new FreeRaceHeat with the given lane assignments."""
    ...

def update_free_race_heat_result(
    db: Session,
    heat_id: int,
    lane_results: list[dict],
) -> models.FreeRaceHeat | None:
    """Record results for a FreeRaceHeat."""
    ...

def get_free_race_heats(
    db: Session,
    race_id: int,
    limit: int = 10,
) -> list[models.FreeRaceHeat]:
    """Get the most recent FreeRaceHeats for a race, newest first."""
    ...

def get_random_lane_assignments(
    db: Session,
    race_id: int,
    lane_count: int,
) -> list[dict]:
    """
    Randomly select `lane_count` checked-in racers and return lane assignments.
    If fewer than `lane_count` racers are checked in, fill remaining lanes with
    empty slots (racer_id=None).
    """
    ...
```

### 3. Write Tests in `backend/test_free_race.py`

Cover:

- `create_free_race_heat` creates a record with correct `lane_assignments`.
- `update_free_race_heat_result` updates `lane_results`.
- `get_free_race_heats` returns records ordered newest-first.
- `get_random_lane_assignments` returns exactly `lane_count` slots, only checked-in racers, no duplicates.
- `get_random_lane_assignments` with fewer checked-in racers than lanes pads with `None` racer_id.

## Verification

```bash
cd /home/dknowles/src/trusty-track
pytest backend/test_free_race.py -v
```

Also run the full backend suite to check for regressions:

```bash
pytest backend/ -v
```

And run ruff + mypy:

```bash
ruff format backend/models.py backend/crud.py backend/test_free_race.py
ruff check backend/models.py backend/crud.py backend/test_free_race.py
mypy backend/models.py backend/crud.py backend/test_free_race.py
```
