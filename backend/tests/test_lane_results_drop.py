"""Dropping `heats.lane_results` keeps everything, or says what it could not.

Issue #72, step 5, migration `0013`. The column was the only copy of anything
`heat_lanes` does not model, so dropping it is the one irreversible act in this
work. Rather than gating that on a release having shipped — a calendar, not a
check — the migration proves losslessness on the database in front of it: every
blob is rebuilt from the table and compared, and a heat that does not round-trip
has its original parked in `heat_lane_blob_archive` first.

These tests are that promise. They run against a **pre-Alembic** database — the
shape a `v1.0.0` install has — so they exercise the upgrade an operator
actually performs, not a synthetic one.

The archive is expected to be empty on a real install. It is not empty here on
purpose: two of the seeded heats hold the two things that genuinely cannot
survive, and the point is that they are kept rather than lost.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.tests.helpers import build_pre_alembic_database, run_alembic

# Every convention a `v1.0.0` database can hold, and what becomes of it.
REBUILDABLE = [
    # A raced heat.
    (
        1,
        [
            {"lane": 1, "racer_id": 1, "time": 3.41, "place": 1},
            {"lane": 2, "racer_id": 2, "time": 3.55, "place": 2},
        ],
    ),
    # Skipped — the one extra key any client ever wrote, and a modelled column.
    (2, [{"lane": 1, "racer_id": 3, "time": None, "place": None, "skipped": True}]),
    # Unadvanced championship slots, as negative racer ids.
    (
        3,
        [
            {"lane": 1, "racer_id": -1, "time": None, "place": None},
            {"lane": 2, "racer_id": -2, "time": None, "place": None},
        ],
    ),
    # A lane nobody is in.
    (4, [{"lane": 1, "racer_id": None, "time": None, "place": None}]),
]

# A time that is a string but *is* a number comes back as one. Same value, and
# `v1.0.0` typed the field `number | string`, so every reader coerced it.
NORMALISED = (5, [{"lane": 1, "racer_id": 4, "time": "3.900", "place": 1}])

UNREBUILDABLE = [
    # `heat_lanes.time_seconds` is a float column, so this became NULL at the
    # upgrade that created the table. The blob has been its only copy since.
    (6, [{"lane": 1, "racer_id": 1, "time": "DNF", "place": None}]),
    # A key nothing models — what `lanes.carry_extras` was protecting.
    (7, [{"lane": 1, "racer_id": 2, "time": 3.2, "place": 1, "mystery": "x"}]),
]


@pytest.fixture
def upgraded(tmp_path) -> Path:
    """A `v1.0.0`-shaped database carrying all of the above, migrated to head."""

    def seed(conn):
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack')"))
        conn.execute(
            text(
                "INSERT INTO races (id, group_id, name, car_numbering_strategy,"
                " global_start_number, championship_trophies, scoring_strategy,"
                " auto_advance_heat) VALUES (1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO rounds (id, race_id, round_number, scheduling_strategy)"
                " VALUES (1, 1, 1, 'PPC')"
            )
        )
        for racer_id in range(1, 6):
            conn.execute(
                text(
                    "INSERT INTO racers (id, race_id, first_name, last_name,"
                    " car_passed_inspection) VALUES (:i, 1, 'R', :n, 0)"
                ),
                {"i": racer_id, "n": str(racer_id)},
            )
        for heat_id, blob in [*REBUILDABLE, NORMALISED, *UNREBUILDABLE]:
            conn.execute(
                text(
                    "INSERT INTO heats (id, race_id, round_id, heat_number,"
                    " lane_results) VALUES (:i, 1, 1, :i, :b)"
                ),
                {"i": heat_id, "b": json.dumps(blob)},
            )

    build_pre_alembic_database(tmp_path, seed=seed)
    result = _run_init_db(tmp_path)
    assert result.returncode == 0, result.stderr
    return tmp_path / "trusty-track.db"


def _run_init_db(data_dir: Path):
    """Migrate to head the way an operator does — through `init_db()`."""
    return subprocess.run(
        [sys.executable, "-c", "from backend.db.database import init_db; init_db()"],
        cwd=Path(__file__).resolve().parents[2],
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(data_dir),
            "HOME": str(data_dir),
        },
        capture_output=True,
        text=True,
    )


def _rows(db: Path, sql: str) -> list:
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            return conn.execute(text(sql)).fetchall()
    finally:
        engine.dispose()


def _blobs(db: Path) -> dict[int, list]:
    return {
        heat_id: json.loads(raw)
        for heat_id, raw in _rows(db, "select id, lane_results from heats")
    }


def test_the_column_is_gone(upgraded):
    engine = create_engine(f"sqlite:///{upgraded}")
    try:
        columns = {c["name"] for c in inspect(engine).get_columns("heats")}
    finally:
        engine.dispose()
    assert "lane_results" not in columns


def test_the_lanes_are_still_there(upgraded):
    """The rows the column was derived from, untouched by its removal."""
    counts = dict(
        _rows(upgraded, "select heat_id, count(*) from heat_lanes group by heat_id")
    )
    assert counts[1] == 2
    assert counts[3] == 2
    assert sum(counts.values()) == 9


def test_only_what_could_not_be_rebuilt_is_archived(upgraded):
    """The whole promise: verified against this database, not assumed."""
    archived = dict(
        _rows(upgraded, "select heat_id, lane_results from heat_lane_blob_archive")
    )

    assert set(archived) == {heat_id for heat_id, _ in UNREBUILDABLE}, (
        "a heat was archived that heat_lanes can express, or one was lost that "
        "it cannot"
    )
    assert json.loads(archived[6])[0]["time"] == "DNF"
    assert json.loads(archived[7])[0]["mystery"] == "x"


def test_a_rebuildable_heat_is_not_archived(upgraded):
    """Including the skipped heat and the placeholders, which look exotic and
    are fully modelled — `skipped` is a column and a slot is a column."""
    archived = {
        row[0] for row in _rows(upgraded, "select heat_id from heat_lane_blob_archive")
    }
    for heat_id, _ in REBUILDABLE:
        assert heat_id not in archived


def test_a_numeric_string_time_is_not_treated_as_a_loss(upgraded):
    """`"3.900"` and `3.9` are the same time. Archiving every heat an older
    client wrote a string into would make the archive useless."""
    archived = {
        row[0] for row in _rows(upgraded, "select heat_id from heat_lane_blob_archive")
    }
    assert NORMALISED[0] not in archived


# --------------------------------------------------------------------------- #
# The way back                                                                 #
# --------------------------------------------------------------------------- #


def test_the_downgrade_restores_every_blob(upgraded, tmp_path):
    """Down and back up holds what it started with.

    This is what makes dropping the column a decision rather than a gamble: the
    rebuildable heats come from `heat_lanes`, and the two that could not be
    rebuilt come back verbatim from the archive.
    """
    result = run_alembic(tmp_path, "downgrade", "0012_debug_mode_default")
    assert result.returncode == 0, result.stderr

    blobs = _blobs(upgraded)

    for heat_id, original in REBUILDABLE:
        assert blobs[heat_id] == original, f"heat {heat_id} did not round-trip"

    # Restored exactly, from the archive rather than from the table.
    for heat_id, original in UNREBUILDABLE:
        assert blobs[heat_id] == original

    # The one documented difference, and it is a type rather than a value.
    heat_id, original = NORMALISED
    assert blobs[heat_id] == [{"lane": 1, "racer_id": 4, "time": 3.9, "place": 1}]
    assert float(original[0]["time"]) == blobs[heat_id][0]["time"]


def test_the_archive_goes_with_the_column(upgraded, tmp_path):
    """It exists to survive the drop; a database that has the column back has
    no use for it, and leaving it would be schema drift against a fresh
    install of the older version."""
    assert run_alembic(tmp_path, "downgrade", "0012_debug_mode_default").returncode == 0

    engine = create_engine(f"sqlite:///{upgraded}")
    try:
        assert "heat_lane_blob_archive" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_a_clean_database_archives_nothing(tmp_path):
    """What every real install should see: the table exists and is empty.

    An empty archive is the evidence that this install's drop was lossless.
    """

    def seed(conn):
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack')"))
        conn.execute(
            text(
                "INSERT INTO races (id, group_id, name, car_numbering_strategy,"
                " global_start_number, championship_trophies, scoring_strategy,"
                " auto_advance_heat) VALUES (1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO rounds (id, race_id, round_number, scheduling_strategy)"
                " VALUES (1, 1, 1, 'PPC')"
            )
        )
        for racer_id in range(1, 6):
            conn.execute(
                text(
                    "INSERT INTO racers (id, race_id, first_name, last_name,"
                    " car_passed_inspection) VALUES (:i, 1, 'R', :n, 0)"
                ),
                {"i": racer_id, "n": str(racer_id)},
            )
        for heat_id, blob in REBUILDABLE:
            conn.execute(
                text(
                    "INSERT INTO heats (id, race_id, round_id, heat_number,"
                    " lane_results) VALUES (:i, 1, 1, :i, :b)"
                ),
                {"i": heat_id, "b": json.dumps(blob)},
            )

    build_pre_alembic_database(tmp_path, seed=seed)
    assert _run_init_db(tmp_path).returncode == 0

    db = tmp_path / "trusty-track.db"
    assert _rows(db, "select count(*) from heat_lane_blob_archive")[0][0] == 0


def test_a_lane_naming_a_deleted_racer_is_archived(tmp_path):
    """Correct, and worth stating because it looks like a false positive.

    No foreign key ever guarded the blob, so it can name a racer who is gone.
    Migration `0003` stores that lane with a NULL `racer_id` rather than
    failing — so the blob is the only remaining record of who was in it, which
    is exactly the condition for keeping it.
    """

    def seed(conn):
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack')"))
        conn.execute(
            text(
                "INSERT INTO races (id, group_id, name, car_numbering_strategy,"
                " global_start_number, championship_trophies, scoring_strategy,"
                " auto_advance_heat) VALUES (1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO rounds (id, race_id, round_number, scheduling_strategy)"
                " VALUES (1, 1, 1, 'PPC')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO racers (id, race_id, first_name, last_name,"
                " car_passed_inspection) VALUES (1, 1, 'R', '1', 0)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO heats (id, race_id, round_id, heat_number, lane_results)"
                " VALUES (1, 1, 1, 1, :b)"
            ),
            {"b": json.dumps([{"lane": 1, "racer_id": 999, "time": 3.2, "place": 1}])},
        )

    build_pre_alembic_database(tmp_path, seed=seed)
    assert _run_init_db(tmp_path).returncode == 0

    db = tmp_path / "trusty-track.db"
    archived = dict(
        _rows(db, "select heat_id, lane_results from heat_lane_blob_archive")
    )
    assert json.loads(archived[1])[0]["racer_id"] == 999
