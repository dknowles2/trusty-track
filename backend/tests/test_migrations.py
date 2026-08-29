"""Tests for Alembic migrations.

The most valuable test here is `test_migrations_reproduce_the_models`: without
it, `models.py` and the migration chain can drift apart silently, which is the
exact failure mode Alembic was adopted to prevent.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.tests.helpers import build_pre_alembic_database, run_alembic

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _run_init_db(data_dir: Path) -> subprocess.CompletedProcess:
    """Run init_db() in a subprocess with its own data directory.

    A subprocess is used because backend.db.database resolves its engine and
    paths at import time from the environment.
    """
    return subprocess.run(
        [sys.executable, "-c", "from backend.db.database import init_db; init_db()"],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(data_dir),
            "HOME": str(data_dir),
        },
        capture_output=True,
        text=True,
    )


def _table_names(db_path: Path) -> set:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def _column_names(db_path: Path, table: str) -> set:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        return {c["name"] for c in inspect(engine).get_columns(table)}
    finally:
        engine.dispose()


def _schema_snapshot(db_path: Path) -> dict:
    """Everything about the schema that two installs must agree on.

    `alembic check` is not enough on its own, and believing it was is how the
    drift below survived: it compares `models.py` against the database, and by
    default it does *not* compare server defaults. A column that is `NOT NULL`
    with no default therefore reports clean while a fresh install has
    `DEFAULT 0` — the two schemas differ and Alembic says they do not.

    Reflected attributes rather than raw DDL text: SQLite's stored `CREATE
    TABLE` differs in identifier quoting and in the order constraints were
    declared, neither of which is a difference in the schema.
    """
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        inspector = inspect(engine)
        return {
            table: {
                "columns": sorted(
                    (
                        column["name"],
                        str(column["type"]),
                        bool(column["nullable"]),
                        None if column["default"] is None else str(column["default"]),
                    )
                    for column in inspector.get_columns(table)
                ),
                "indexes": sorted(
                    (index["name"], tuple(index["column_names"]), bool(index["unique"]))
                    for index in inspector.get_indexes(table)
                ),
                "foreign_keys": sorted(
                    (
                        tuple(fk["constrained_columns"]),
                        fk["referred_table"],
                        tuple(fk["referred_columns"]),
                        (fk.get("options") or {}).get("ondelete"),
                    )
                    for fk in inspector.get_foreign_keys(table)
                ),
                "primary_key": tuple(
                    inspector.get_pk_constraint(table)["constrained_columns"]
                ),
                "unique_constraints": sorted(
                    (unique["name"], tuple(unique["column_names"]))
                    for unique in inspector.get_unique_constraints(table)
                ),
            }
            for table in sorted(inspector.get_table_names())
        }
    finally:
        engine.dispose()


def _revision(db_path: Path) -> str:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            return conn.execute(
                text("select version_num from alembic_version")
            ).scalar()
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def fresh_database(tmp_path_factory) -> Path:
    """A database created from nothing by `init_db()` — the reference schema.

    Session-scoped because building one runs the whole migration chain in a
    subprocess, and nothing that compares against it modifies it.
    """
    data_dir = tmp_path_factory.mktemp("fresh")
    result = _run_init_db(data_dir)
    assert result.returncode == 0, result.stderr
    return data_dir / "trusty-track.db"


def test_fresh_database_is_fully_migrated(tmp_path):
    """A brand new install ends up at head with every table present."""
    result = _run_init_db(tmp_path)
    assert result.returncode == 0, result.stderr

    db = tmp_path / "trusty-track.db"
    tables = _table_names(db)
    assert {
        "organizations",
        "tracks",
        "races",
        "racing_groups",
        "racers",
        "rounds",
        "heats",
        "heat_lanes",
        "alembic_version",
    } <= tables
    assert "free_race_heats" not in tables, "folded into heats by #6"
    assert "dens" not in tables, "renamed to racing_groups (issue #496)"
    assert "den_id" not in _column_names(db, "racers")
    assert "debug_mode" in _column_names(db, "organizations")


def test_init_db_is_idempotent(tmp_path):
    """Running init_db repeatedly is a no-op after the first time."""
    assert _run_init_db(tmp_path).returncode == 0
    first = _revision(tmp_path / "trusty-track.db")

    assert _run_init_db(tmp_path).returncode == 0
    assert _revision(tmp_path / "trusty-track.db") == first


@pytest.mark.parametrize("already_has_debug_mode", [True, False])
def test_legacy_database_is_adopted_without_data_loss(tmp_path, already_has_debug_mode):
    """Pre-Alembic databases are stamped and upgraded, keeping their data.

    Covers both variants in the wild: the old hand-rolled ALTER either ran
    (column present) or silently failed (column absent).
    """
    db = build_pre_alembic_database(
        tmp_path,
        legacy_debug_mode="BOOLEAN DEFAULT 0" if already_has_debug_mode else None,
        seed=lambda conn: conn.execute(
            text("INSERT INTO groups (id, name) VALUES (1, 'Pack 42')")
        ),
    )

    result = _run_init_db(tmp_path)
    assert result.returncode == 0, result.stderr

    # Stamped and upgraded rather than left unversioned.
    assert "alembic_version" in _table_names(db)
    assert "debug_mode" in _column_names(db, "organizations")

    # Pre-existing data survived.
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(text("select name from organizations")).scalar()
                == "Pack 42"
            )
    finally:
        engine.dispose()


def test_legacy_database_with_empty_alembic_version_is_adopted(tmp_path):
    """An empty `alembic_version` table must not be mistaken for "already managed".

    Alembic creates that table as soon as anything reads the version — a bare
    `alembic check` is enough — leaving it present but with no row. Detecting
    legacy databases by the table's presence therefore skipped the stamp and
    then ran the baseline migration against tables that already existed,
    failing with "table groups already exists" at startup.
    """

    def seed(conn):
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack 7')"))
        # Present but empty, exactly as Alembic leaves it after a read.
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))

    db = build_pre_alembic_database(tmp_path, seed=seed)

    result = _run_init_db(tmp_path)
    assert result.returncode == 0, result.stderr

    assert _revision(db) is not None, "database was left unversioned"
    assert "debug_mode" in _column_names(db, "organizations")

    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(text("select name from organizations")).scalar()
                == "Pack 7"
            )
    finally:
        engine.dispose()


def _alembic_check(data_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(data_dir),
            "HOME": str(data_dir),
        },
        capture_output=True,
        text=True,
    )


def test_migrations_reproduce_the_models(tmp_path):
    """`alembic check` must find no drift between the chain and models.py.

    If this fails, someone changed a model without adding a migration. That is
    the drift the old create_all() approach hid until it crashed at runtime.
    """
    assert _run_init_db(tmp_path).returncode == 0

    result = _alembic_check(tmp_path)
    assert result.returncode == 0, (
        "models.py and the migration chain have drifted. Generate a migration "
        "with `alembic revision --autogenerate -m '<description>'`.\n\n"
        f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    )


@pytest.mark.parametrize(
    "legacy_debug_mode",
    [
        pytest.param(None, id="the old ALTER never ran"),
        pytest.param("BOOLEAN DEFAULT 0", id="the old ALTER ran, leaving it nullable"),
        pytest.param("BOOLEAN NOT NULL", id="create_all made it, as on v1.0.0"),
        pytest.param("BOOLEAN DEFAULT 0 NOT NULL", id="already correct"),
    ],
)
def test_an_adopted_database_ends_up_with_the_same_schema(
    tmp_path, legacy_debug_mode, fresh_database
):
    """A migrated legacy install must be indistinguishable from a fresh one.

    Issue #32. `test_migrations_reproduce_the_models` only ever checked a
    *freshly created* database, so it was blind to the one path most likely to
    produce drift — and it did: `groups.debug_mode` stayed nullable wherever the
    old hand-rolled ALTER had already run, because 0002 skips the column when it
    is present and cannot know how it was declared.

    Adopted and fresh installs converging is the whole promise of #3. If they
    do not, `alembic check` reports drift on a real user's database that is
    nobody's fault, which teaches people to ignore it.

    The comparison is against an actual fresh database, not just `alembic
    check`. Checking alone is what let the `v1.0.0` case below go unnoticed:
    Alembic does not compare server defaults, so a column left `NOT NULL` with
    no default reported clean against a fresh install carrying `DEFAULT 0`.
    """
    # The v1.0.0 shape has no server default, so the value has to be supplied —
    # which is what the ORM did, and why nobody noticed it was missing.
    insert = (
        "INSERT INTO groups (id, name) VALUES (1, 'Pack 42')"
        if legacy_debug_mode is None
        else "INSERT INTO groups (id, name, debug_mode) VALUES (1, 'Pack 42', 0)"
    )

    db = build_pre_alembic_database(
        tmp_path,
        legacy_debug_mode=legacy_debug_mode,
        seed=lambda conn: conn.execute(text(insert)),
    )

    assert _run_init_db(tmp_path).returncode == 0

    result = _alembic_check(tmp_path)
    assert result.returncode == 0, (
        "an adopted database does not match models.py, so it differs from a "
        "fresh install.\n\n"
        f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    )

    assert _schema_snapshot(db) == _schema_snapshot(fresh_database), (
        "an adopted database's schema differs from a fresh install's. Alembic "
        "reported clean, so the difference is in something it does not compare "
        "— a server default, most likely."
    )

    # And the data is still there — a schema fix that copies the table is only
    # safe if it brings the rows with it.
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(text("select name from organizations")).scalar()
                == "Pack 42"
            )
    finally:
        engine.dispose()


def test_a_null_debug_mode_is_settled_before_the_column_is_tightened(tmp_path):
    """Nothing writes NULL today, but the column has accepted it for as long as
    those installs have existed, and NOT NULL cannot be applied over one."""
    db = build_pre_alembic_database(
        tmp_path,
        legacy_debug_mode="BOOLEAN",
        seed=lambda conn: conn.execute(
            text("INSERT INTO groups (id, name, debug_mode) VALUES (1, 'Pack', NULL)")
        ),
    )

    result = _run_init_db(tmp_path)
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(text("select debug_mode from organizations")).scalar() == 0
            )
    finally:
        engine.dispose()


def test_init_db_raises_when_migrations_are_missing(tmp_path, monkeypatch):
    """A broken install must refuse to start, not silently pass."""
    from backend.db import database

    monkeypatch.setattr(
        database, "_migrations_dir", lambda: tmp_path / "definitely-not-here"
    )
    with pytest.raises(RuntimeError, match="migrations directory not found"):
        database.init_db()


def test_every_downgrade_runs_and_lands_back_at_the_same_schema(
    tmp_path, fresh_database
):
    """Walk the whole chain backwards, then forwards again.

    Every migration ships a `downgrade()` and, until this existed, none had ever
    been run. An unexercised downgrade is worse than an absent one: it is only
    reached when something has already gone wrong and somebody is rolling back
    under pressure, which is the worst moment to discover it does not work.

    Ending at the same schema is the part worth asserting. A downgrade that
    runs without error but rebuilds a table slightly differently — dropping an
    index, losing a server default — leaves a database that is *not* what a
    fresh install has, and the next upgrade builds on top of that.
    """
    assert _run_init_db(tmp_path).returncode == 0
    db = tmp_path / "trusty-track.db"

    down = run_alembic(tmp_path, "downgrade", "base")
    assert down.returncode == 0, (
        f"a migration cannot be undone.\n\nstderr:\n{down.stderr}"
    )
    assert _table_names(db) == {"alembic_version"}, (
        "downgrading to base left tables behind, so some downgrade is not the "
        "inverse of its upgrade"
    )

    up = run_alembic(tmp_path, "upgrade", "head")
    assert up.returncode == 0, up.stderr

    assert _schema_snapshot(db) == _schema_snapshot(fresh_database)


def test_a_downgrade_past_the_folded_heats_keeps_the_data(tmp_path):
    """The two migrations that move rows, undone and redone.

    `0003` projects `lane_results` into `heat_lanes` and `0006` folds
    `free_race_heats` into `heats` — the only migrations that carry data rather
    than reshape a table, and so the only ones whose downgrade can silently lose
    some. `0002` is pinned because it is the last revision before `0003`; the
    point is to stop *just* below the pair, with every app table still there.
    """
    assert _run_init_db(tmp_path).returncode == 0
    db = tmp_path / "trusty-track.db"

    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.begin() as conn:
            _seed_a_small_race(conn)
        with engine.connect() as conn:
            before = _race_shape(conn)
    finally:
        engine.dispose()

    assert run_alembic(tmp_path, "downgrade", "0002_debug_mode").returncode == 0
    # Back in the two-table world: the free heats have their own table again.
    assert "free_race_heats" in _table_names(db)
    assert "heat_lanes" not in _table_names(db)

    assert run_alembic(tmp_path, "upgrade", "head").returncode == 0

    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert _race_shape(conn) == before
    finally:
        engine.dispose()


def _seed_a_small_race(conn) -> None:
    """One race with a run heat, a skipped heat and an unfilled championship.

    Between them these cover what the blob encodes that a plain row does not:
    a time, the `skipped` key nothing in the backend reads, and the negative
    racer ids standing in for racers who have not advanced yet.
    """
    conn.execute(text("INSERT INTO organizations (id, name) VALUES (1, 'Pack 42')"))
    conn.execute(
        text(
            "INSERT INTO tracks (id, name, lane_count, timer_type,"
            " remote_start_installed) VALUES (1, 'Main', 2, 'FAKE', 0)"
        )
    )
    conn.execute(
        text(
            "INSERT INTO races"
            " (id, organization_id, track_id, name, car_numbering_strategy,"
            " global_start_number, championship_trophies, scoring_strategy,"
            " auto_advance_heat)"
            " VALUES (1, 1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
        )
    )
    for racer_id in (1, 2):
        conn.execute(
            text(
                "INSERT INTO racers (id, race_id, first_name, last_name,"
                " car_passed_inspection) VALUES (:i, 1, 'Racer', :n, 1)"
            ),
            {"i": racer_id, "n": str(racer_id)},
        )
    conn.execute(
        text(
            "INSERT INTO rounds (id, race_id, round_number, name,"
            " scheduling_strategy) VALUES (1, 1, 1, 'Prelim', 'PPC')"
        )
    )

    run = '[{"lane": 1, "racer_id": 1, "time": 3.41, "place": 1}]'
    skipped = (
        '[{"lane": 1, "racer_id": 2, "time": null, "place": null, "skipped": true}]'
    )
    placeholder = '[{"lane": 1, "racer_id": -1, "time": null, "place": null}]'
    for heat_id, (number, blob) in enumerate(
        ((1, run), (2, skipped), (3, placeholder)), start=1
    ):
        conn.execute(
            text(
                "INSERT INTO heats (id, race_id, round_id, kind, heat_number)"
                " VALUES (:i, 1, 1, 'OFFICIAL', :n)"
            ),
            {"i": heat_id, "n": number},
        )
        for lane in _lanes_of(blob):
            conn.execute(
                text(
                    "INSERT INTO heat_lanes (heat_id, lane, racer_id,"
                    " placeholder_slot, time_seconds, place, skipped)"
                    " VALUES (:h, :l, :r, :p, :t, :pl, :s)"
                ),
                {"h": heat_id, **lane},
            )

    free = '[{"lane": 1, "racer_id": 1, "time": 3.55, "place": 1}]'
    conn.execute(
        text(
            "INSERT INTO heats (id, race_id, round_id, kind, heat_number,"
            " created_at) VALUES (4, 1, NULL, 'FREE', 1, :c)"
        ),
        {"c": "2026-03-01T10:00:00"},
    )
    for lane in _lanes_of(free):
        conn.execute(
            text(
                "INSERT INTO heat_lanes (heat_id, lane, racer_id, placeholder_slot,"
                " time_seconds, place, skipped) VALUES (4, :l, :r, :p, :t, :pl, :s)"
            ),
            lane,
        )


def _lanes_of(blob: str) -> list[dict]:
    """The `heat_lanes` rows a blob projects to, in the table's own vocabulary."""
    rows = []
    for entry in json.loads(blob):
        racer_id = entry["racer_id"]
        rows.append(
            {
                "l": entry["lane"],
                "r": racer_id if racer_id > 0 else None,
                "p": None if racer_id > 0 else -racer_id,
                "t": entry["time"],
                "pl": entry["place"],
                "s": 1 if entry.get("skipped") else 0,
            }
        )
    return rows


def _race_shape(conn) -> dict:
    """What the round trip must not change."""
    return {
        "heats": conn.execute(
            text("select id, kind, heat_number from heats order by id")
        ).fetchall(),
        "lanes": conn.execute(
            text(
                "select heat_id, lane, racer_id, placeholder_slot, time_seconds,"
                " place, skipped from heat_lanes order by heat_id, lane"
            )
        ).fetchall(),
        "racers": conn.execute(
            text("select id, first_name, last_name from racers order by id")
        ).fetchall(),
    }
