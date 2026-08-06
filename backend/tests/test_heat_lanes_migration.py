"""The heat_lanes backfill reproduces the lane_results blobs exactly.

Issue #5. This migration is the one that touches every heat a user has ever
run, so the tests here are mostly about fidelity and reversibility rather than
about the schema.

These run against a **pre-Alembic** database — the shape a `v1.0.0` install
has — and migrate it to `head`, so they are the only coverage of the upgrade an
existing operator actually performs. Every migration since is in that path,
including `0010`'s table rebuild.

The direction of truth has since reversed, and the downgrade is what changed
with it. `heat_lanes` is where every reader looks now (#123, #124) and its rows
come from the lane values a writer supplied rather than from parsing the string
(#120). `lane_results` is written alongside as a **derived** column, which is
what still makes the downgrade lossless — and, until a release has shipped
carrying this, it is also the only way back for a database upgraded from
`v1.0.0`. That is why the column is still here; see #72.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.tests.helpers import build_pre_alembic_database

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _run(code: str, data_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(data_dir),
            "HOME": str(data_dir),
        },
        capture_output=True,
        text=True,
    )


def _init_db(data_dir: Path) -> subprocess.CompletedProcess:
    return _run("from backend.db.database import init_db; init_db()", data_dir)


def _alembic(data_dir: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(data_dir),
            "HOME": str(data_dir),
        },
        capture_output=True,
        text=True,
    )


def _seed_pre_migration(db_path: Path, heats: list, free_heats: list = ()) -> None:
    """Build a pre-Alembic database holding blob data, ready to be migrated.

    The schema comes from `0001_baseline` rather than a hand-written CREATE
    TABLE. A minimal fixture that declares only the columns a test reads passes
    until some later migration touches a column it left out, and then fails
    looking like the migration is at fault — which is exactly what happened when
    #6 made `heats.round_id` nullable.
    """

    def seed(conn):
        # The rows every heat and racer below points at. They were left out
        # while SQLite's foreign keys were off, which made them optional in
        # practice and invisible in the schema; with enforcement on they are
        # simply the truth about what a heat needs to exist.
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack 1')"))
        conn.execute(
            text(
                "INSERT INTO races (id, group_id, name, car_numbering_strategy, "
                "global_start_number, championship_trophies, scoring_strategy, "
                "auto_advance_heat) "
                "VALUES (1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO rounds (id, race_id, round_number, "
                "scheduling_strategy) VALUES (1, 1, 1, 'PPC')"
            )
        )
        for racer_id in range(1, 20):
            conn.execute(
                text(
                    "INSERT INTO racers "
                    "(id, race_id, first_name, last_name, car_passed_inspection) "
                    "VALUES (:i, 1, 'Racer', :n, 0)"
                ),
                {"i": racer_id, "n": str(racer_id)},
            )
        for heat_id, blob in heats:
            conn.execute(
                text(
                    "INSERT INTO heats (id, race_id, round_id, heat_number, "
                    "lane_results) VALUES (:i, 1, 1, :i, :b)"
                ),
                {"i": heat_id, "b": blob},
            )
        for heat_id, assignments, results in free_heats:
            conn.execute(
                text(
                    "INSERT INTO free_race_heats (id, race_id, lane_assignments, "
                    "lane_results, created_at) "
                    "VALUES (:i, 1, :a, :r, '2026-01-01T00:00:00Z')"
                ),
                {"i": heat_id, "a": assignments, "r": results},
            )

    built = build_pre_alembic_database(db_path.parent, seed=seed)
    assert built == db_path


def _free_heat_id(tmp_path: Path) -> int:
    """The id a folded free race heat ended up with (#6 renumbers them)."""
    engine = create_engine(f"sqlite:///{tmp_path / 'trusty-track.db'}")
    try:
        with engine.connect() as conn:
            return conn.execute(
                text("SELECT id FROM heats WHERE kind = 'FREE' ORDER BY id")
            ).scalar()
    finally:
        engine.dispose()


def _lanes(db_path: Path, heat_id: int = 1) -> list[dict]:
    """This heat's lanes. `heat_id` is the id in `heats` after all migrations —
    free race heats were renumbered when #6 folded them in."""
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT lane, racer_id, placeholder_slot, time_seconds, place, "
                    "skipped FROM heat_lanes WHERE heat_id = :h ORDER BY lane"
                ),
                {"h": heat_id},
            )
            return [dict(r._mapping) for r in rows]
    finally:
        engine.dispose()


def test_a_recorded_heat_becomes_one_row_per_lane(tmp_path):
    blob = json.dumps(
        [
            {"lane": 1, "racer_id": 4, "time": 3.452, "place": 2},
            {"lane": 2, "racer_id": 7, "time": 3.311, "place": 1},
        ]
    )
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    rows = _lanes(tmp_path / "trusty-track.db")
    assert len(rows) == 2
    assert rows[0] == {
        "lane": 1,
        "racer_id": 4,
        "placeholder_slot": None,
        "time_seconds": 3.452,
        "place": 2,
        "skipped": 0,
    }


def test_negative_ids_become_placeholder_slots(tmp_path):
    """The encoding a real foreign key cannot express."""
    blob = json.dumps(
        [
            {"lane": 1, "racer_id": -1, "time": None, "place": None},
            {"lane": 2, "racer_id": -2, "time": None, "place": None},
        ]
    )
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    rows = _lanes(tmp_path / "trusty-track.db")
    assert [r["placeholder_slot"] for r in rows] == [1, 2]
    assert [r["racer_id"] for r in rows] == [None, None]


def test_an_empty_lane_has_neither_a_racer_nor_a_slot(tmp_path):
    blob = json.dumps([{"lane": 1, "racer_id": None, "time": None, "place": None}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    row = _lanes(tmp_path / "trusty-track.db")[0]
    assert row["racer_id"] is None and row["placeholder_slot"] is None


def test_the_skipped_flag_becomes_a_column(tmp_path):
    """Written by the operator UI, never read by the backend until now."""
    blob = json.dumps([{"lane": 1, "racer_id": 3, "time": None, "skipped": True}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    assert _lanes(tmp_path / "trusty-track.db")[0]["skipped"] == 1


def test_string_times_are_coerced_to_numbers(tmp_path):
    """The frontend sometimes wrote times as strings."""
    blob = json.dumps([{"lane": 1, "racer_id": 3, "time": "3.45", "place": 1}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    assert _lanes(tmp_path / "trusty-track.db")[0]["time_seconds"] == 3.45


def test_an_unparseable_time_becomes_null_rather_than_failing(tmp_path):
    blob = json.dumps([{"lane": 1, "racer_id": 3, "time": "not a time"}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    assert _init_db(tmp_path).returncode == 0

    assert _lanes(tmp_path / "trusty-track.db")[0]["time_seconds"] is None


@pytest.mark.parametrize("blob", [None, "", "null", "not json", "{}", "[1, 2]"])
def test_unreadable_blobs_produce_no_rows_instead_of_failing(tmp_path, blob):
    """An install that will not start is worse than a heat that shows unraced."""
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    result = _init_db(tmp_path)
    assert result.returncode == 0, result.stderr
    assert _lanes(tmp_path / "trusty-track.db") == []


def test_a_lane_naming_a_deleted_racer_is_emptied_not_fatal(tmp_path):
    """No foreign key ever guarded the blob, so it can name a racer that is gone."""
    blob = json.dumps([{"lane": 1, "racer_id": 9999, "time": 3.0, "place": 1}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [(1, blob)])
    result = _init_db(tmp_path)
    assert result.returncode == 0, result.stderr

    row = _lanes(tmp_path / "trusty-track.db")[0]
    assert row["racer_id"] is None
    assert row["time_seconds"] == 3.0, "the result itself should survive"


def test_free_race_heats_merge_assignments_with_results(tmp_path):
    """Free race splits the schedule and the results across two columns."""
    assignments = json.dumps([{"lane": 1, "racer_id": 5}, {"lane": 2, "racer_id": 6}])
    results = json.dumps([{"lane": 1, "racer_id": 5, "time": 3.2, "place": 1}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [], [(1, assignments, results)])
    assert _init_db(tmp_path).returncode == 0

    rows = _lanes(tmp_path / "trusty-track.db", heat_id=_free_heat_id(tmp_path))
    assert len(rows) == 2, "both lanes should be present"
    assert rows[0]["time_seconds"] == 3.2, "the recorded result wins"
    assert rows[1]["time_seconds"] is None, "an unrun lane keeps its assignment"


def test_free_race_results_stored_as_the_string_null(tmp_path):
    """Real databases contain this."""
    assignments = json.dumps([{"lane": 1, "racer_id": 5}])
    _seed_pre_migration(tmp_path / "trusty-track.db", [], [(1, assignments, "null")])
    assert _init_db(tmp_path).returncode == 0

    rows = _lanes(tmp_path / "trusty-track.db", heat_id=_free_heat_id(tmp_path))
    assert len(rows) == 1 and rows[0]["racer_id"] == 5


def test_official_and_free_heats_land_in_separate_rows(tmp_path):
    """Their ids collided in the old two-table schema (#4); #6 renumbers the
    free heats as it folds them in, so the lanes must follow the right one."""
    official = json.dumps([{"lane": 1, "racer_id": 2, "time": 9.0}])
    free = json.dumps([{"lane": 1, "racer_id": 3, "time": 1.0}])
    _seed_pre_migration(
        tmp_path / "trusty-track.db", [(1, official)], [(1, free, None)]
    )
    assert _init_db(tmp_path).returncode == 0

    assert _lanes(tmp_path / "trusty-track.db", 1)[0]["racer_id"] == 2
    rows = _lanes(tmp_path / "trusty-track.db", _free_heat_id(tmp_path))
    assert rows[0]["racer_id"] == 3


def test_downgrade_drops_the_table_and_leaves_the_blobs_alone(tmp_path):
    """Reversibility is the whole reason this step does not switch readers over."""
    blob = json.dumps([{"lane": 1, "racer_id": 4, "time": 3.5, "place": 1}])
    db_path = tmp_path / "trusty-track.db"
    _seed_pre_migration(db_path, [(1, blob)])
    assert _init_db(tmp_path).returncode == 0
    assert _lanes(db_path) != []

    # Named rather than "-1": this test is about *this* migration, and a later
    # one being added should not silently point it at something else.
    result = _alembic(tmp_path, "downgrade", "0002_debug_mode")
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        assert "heat_lanes" not in set(inspect(engine).get_table_names())
        with engine.connect() as conn:
            still_there = conn.execute(text("SELECT lane_results FROM heats")).scalar()
        assert json.loads(still_there) == json.loads(blob)
    finally:
        engine.dispose()


def test_upgrading_again_after_a_downgrade_reproduces_the_rows(tmp_path):
    blob = json.dumps(
        [{"lane": 1, "racer_id": 4, "time": 3.5}, {"lane": 2, "racer_id": -1}]
    )
    db_path = tmp_path / "trusty-track.db"
    _seed_pre_migration(db_path, [(1, blob)])
    assert _init_db(tmp_path).returncode == 0
    before = _lanes(db_path)

    assert _alembic(tmp_path, "downgrade", "0002_debug_mode").returncode == 0
    assert _alembic(tmp_path, "upgrade", "head").returncode == 0

    assert _lanes(db_path) == before


def test_a_fresh_database_has_the_table_and_no_rows(tmp_path):
    assert _init_db(tmp_path).returncode == 0
    engine = create_engine(f"sqlite:///{tmp_path / 'trusty-track.db'}")
    try:
        assert "heat_lanes" in set(inspect(engine).get_table_names())
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM heat_lanes")).scalar() == 0
    finally:
        engine.dispose()
