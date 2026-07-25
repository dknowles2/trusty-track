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


def _revision(db_path: Path) -> str:
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            return conn.execute(
                text("select version_num from alembic_version")
            ).scalar()
    finally:
        engine.dispose()


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
        "racing_groups",
        "rounds",
        "heats",
        "free_race_heats",
        "alembic_version",
    } <= tables
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
    db = tmp_path / "trusty-track.db"
    engine = create_engine(f"sqlite:///{db}")
    debug_col = ", debug_mode BOOLEAN DEFAULT 0" if already_has_debug_mode else ""
    with engine.begin() as conn:
        # A minimal stand-in for the pre-Alembic schema.
        conn.execute(
            text(
                f"CREATE TABLE groups (id INTEGER PRIMARY KEY, name VARCHAR{debug_col})"
            )
        )
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack 42')"))
    engine.dispose()

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
    db = tmp_path / "trusty-track.db"
    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE groups (id INTEGER PRIMARY KEY, name VARCHAR)"))
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack 7')"))
        # Present but empty, exactly as Alembic leaves it after a read.
        conn.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
    engine.dispose()

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


def _build_pre_alembic_database(tmp_path: Path, debug_mode: str | None) -> Path:
    """A database as the pre-Alembic ``create_all()`` would have left it.

    Built by running the baseline migration and then removing `alembic_version`,
    rather than by hand: `0001_baseline` *is* the schema `create_all()` produced,
    so this cannot drift from what it claims to reproduce. The minimal
    `groups`-only fixture the other legacy tests use is fine for checking that
    data survives, but it describes a database that never existed, so comparing
    its schema to the models proves nothing.

    ``debug_mode`` is the column definition the old hand-rolled ALTER left
    behind, or None for an install where that statement silently failed.
    """
    db = tmp_path / "trusty-track.db"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0001_baseline"],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(tmp_path),
            "HOME": str(tmp_path),
        },
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        # Un-manage it: this is what a database from before migrations looks like.
        conn.execute(text("DROP TABLE alembic_version"))
        if debug_mode:
            conn.execute(text(f"ALTER TABLE groups ADD COLUMN debug_mode {debug_mode}"))
        conn.execute(text("INSERT INTO groups (id, name) VALUES (1, 'Pack 42')"))
    engine.dispose()
    return db


@pytest.mark.parametrize(
    "legacy_debug_mode",
    [
        pytest.param(None, id="the old ALTER never ran"),
        pytest.param("BOOLEAN DEFAULT 0", id="the old ALTER ran, leaving it nullable"),
        pytest.param("BOOLEAN DEFAULT 0 NOT NULL", id="already correct"),
    ],
)
def test_an_adopted_database_ends_up_with_the_same_schema(tmp_path, legacy_debug_mode):
    """A migrated legacy install must be indistinguishable from a fresh one.

    Issue #32. `test_migrations_reproduce_the_models` only ever checked a
    *freshly created* database, so it was blind to the one path most likely to
    produce drift — and it did: `groups.debug_mode` stayed nullable wherever the
    old hand-rolled ALTER had already run, because 0002 skips the column when it
    is present and cannot know how it was declared.

    Adopted and fresh installs converging is the whole promise of #3. If they
    do not, `alembic check` reports drift on a real user's database that is
    nobody's fault, which teaches people to ignore it.
    """
    db = _build_pre_alembic_database(tmp_path, legacy_debug_mode)

    assert _run_init_db(tmp_path).returncode == 0

    result = _alembic_check(tmp_path)
    assert result.returncode == 0, (
        "an adopted database does not match models.py, so it differs from a "
        "fresh install.\n\n"
        f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
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
    db = _build_pre_alembic_database(tmp_path, "BOOLEAN")
    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        conn.execute(text("UPDATE groups SET debug_mode = NULL"))
    engine.dispose()

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
