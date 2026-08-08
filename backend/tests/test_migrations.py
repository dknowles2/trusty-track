"""Tests for Alembic migrations.

The most valuable test here is `test_migrations_reproduce_the_models`: without
it, `models.py` and the migration chain can drift apart silently, which is the
exact failure mode Alembic was adopted to prevent.
"""

import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.tests.helpers import build_pre_alembic_database

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
        "groups",
        "tracks",
        "races",
        "dens",
        "racers",
        "rounds",
        "heats",
        "heat_lanes",
        "alembic_version",
    } <= tables
    assert "free_race_heats" not in tables, "folded into heats by #6"
    assert "racing_groups" not in tables, "a shadow of dens, dropped by 0008"
    assert "racing_group_id" not in _column_names(db, "racers")
    assert "debug_mode" in _column_names(db, "groups")


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
    assert "debug_mode" in _column_names(db, "groups")

    # Pre-existing data survived.
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert conn.execute(text("select name from groups")).scalar() == "Pack 42"
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
    assert "debug_mode" in _column_names(db, "groups")

    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            assert conn.execute(text("select name from groups")).scalar() == "Pack 7"
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
            assert conn.execute(text("select name from groups")).scalar() == "Pack 42"
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
            assert conn.execute(text("select debug_mode from groups")).scalar() == 0
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
