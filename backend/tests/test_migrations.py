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


def test_migrations_reproduce_the_models(tmp_path):
    """`alembic check` must find no drift between the chain and models.py.

    If this fails, someone changed a model without adding a migration. That is
    the drift the old create_all() approach hid until it crashed at runtime.
    """
    assert _run_init_db(tmp_path).returncode == 0

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=REPO_ROOT,
        env={
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TRUSTYTRACK_DATA_DIR": str(tmp_path),
            "HOME": str(tmp_path),
        },
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        "models.py and the migration chain have drifted. Generate a migration "
        "with `alembic revision --autogenerate -m '<description>'`.\n\n"
        f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    )


def test_init_db_raises_when_migrations_are_missing(tmp_path, monkeypatch):
    """A broken install must refuse to start, not silently pass."""
    from backend.db import database

    monkeypatch.setattr(
        database, "_migrations_dir", lambda: tmp_path / "definitely-not-here"
    )
    with pytest.raises(RuntimeError, match="migrations directory not found"):
        database.init_db()
