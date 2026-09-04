"""The Alembic CLI refuses to touch a real database by accident (#689).

`uv run alembic revision --autogenerate` / `upgrade head` / `check` — the
workflow CLAUDE.md prescribes for every schema change — used to open whatever
`TRUSTYTRACK_DATA_DIR` resolves to, which for a contributor who has never set
it is `~/.trustytrack`: the same file a real install's event and every
uploaded photograph of a child live in. `backend/migrations/env.py`'s
`_refuse_unsafe_cli_target` closes that off; these tests exercise it from both
sides — the guard itself, and the one path it must never touch,
`init_db()`'s own call at app startup.

`backend.db.database._sqlite_file_has_a_configured_organization` is tested
directly, in-process; the guard's wiring through the Alembic CLI needs a real
subprocess, since it runs in a separate process from whatever invoked
`alembic`, the same reason `backend/tests/helpers.py::run_alembic` already
shells out.
"""

import sqlite3
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine

from backend.db import models  # noqa: F401 — registers the tables on Base
from backend.db.database import Base, _sqlite_file_has_a_configured_organization

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", **env},
        capture_output=True,
        text=True,
    )


def _alembic_with_home_only(home: Path, *args: str) -> subprocess.CompletedProcess:
    """Run the Alembic CLI as a contributor who has never set the data dir.

    Only ``HOME`` is set, so ``TRUSTYTRACK_DATA_DIR``/``TRUSTYTRACK_DB_URL``
    are both genuinely absent and the module resolves the same default
    (``~/.trustytrack``) an unconfigured checkout would — unlike
    ``helpers.run_alembic``, which sets ``TRUSTYTRACK_DATA_DIR`` explicitly
    for every other test in the suite and so never exercises this guard.
    """
    return _run(
        [sys.executable, "-m", "alembic", *args],
        {"HOME": str(home)},
    )


def _init_db_with_home_only(home: Path) -> subprocess.CompletedProcess:
    return _run(
        [sys.executable, "-c", "from backend.db.database import init_db; init_db()"],
        {"HOME": str(home)},
    )


def _seed_configured_database(home: Path) -> None:
    """Build a database that looks like a real, already-configured install."""
    result = _alembic_with_home_only(home, "upgrade", "head")
    assert result.returncode == 0, result.stderr
    db = home / ".trustytrack" / "trusty-track.db"
    connection = sqlite3.connect(db)
    try:
        connection.execute(
            "INSERT INTO organizations (id, name, debug_mode) "
            "VALUES (1, 'Test Pack', 0)"
        )
        connection.commit()
    finally:
        connection.close()


# ── _sqlite_file_has_a_configured_organization, in-process ─────────────────


def test_a_missing_file_holds_no_real_data(tmp_path):
    assert _sqlite_file_has_a_configured_organization(tmp_path / "nope.db") is False


def test_an_empty_schema_holds_no_real_data(tmp_path):
    db = tmp_path / "trusty-track.db"
    engine = create_engine(f"sqlite:///{db}")
    try:
        Base.metadata.create_all(engine)
    finally:
        engine.dispose()

    assert _sqlite_file_has_a_configured_organization(db) is False


def test_a_configured_organization_is_real_data(tmp_path):
    db = tmp_path / "trusty-track.db"
    engine = create_engine(f"sqlite:///{db}")
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                models.Organization.__table__.insert().values(
                    name="Test Pack", debug_mode=False
                )
            )
    finally:
        engine.dispose()

    assert _sqlite_file_has_a_configured_organization(db) is True


def test_a_file_that_is_not_a_database_is_treated_as_real(tmp_path):
    """Unreadable resolves to True — the safe direction to be wrong in."""
    db = tmp_path / "trusty-track.db"
    db.write_bytes(b"not a sqlite file")

    assert _sqlite_file_has_a_configured_organization(db) is True


# ── the CLI guard, end to end ───────────────────────────────────────────────


def test_cli_allows_a_fresh_default_data_dir(tmp_path):
    """The ordinary first-run development case must not be obstructed."""
    result = _alembic_with_home_only(tmp_path, "upgrade", "head")
    assert result.returncode == 0, result.stderr


def test_cli_allows_a_configured_but_empty_schema(tmp_path):
    """Schema exists, nobody has configured an organization yet: still fine."""
    first = _alembic_with_home_only(tmp_path, "upgrade", "head")
    assert first.returncode == 0, first.stderr

    second = _alembic_with_home_only(tmp_path, "current")
    assert second.returncode == 0, second.stderr


def test_cli_refuses_a_configured_default_data_dir(tmp_path):
    _seed_configured_database(tmp_path)

    result = _alembic_with_home_only(tmp_path, "upgrade", "head")

    assert result.returncode != 0
    assert "689" in result.stderr
    assert "scripts/migrate.sh" in result.stderr
    assert "TRUSTYTRACK_ALLOW_UNSAFE_MIGRATION" in result.stderr
    # And no traceback — CommandError is caught and printed plainly.
    assert "Traceback" not in result.stderr


def test_cli_allows_an_explicit_data_dir_even_when_configured(tmp_path):
    """Setting TRUSTYTRACK_DATA_DIR is itself the opt-in; the guard steps aside."""
    _seed_configured_database(tmp_path)

    result = _run(
        [sys.executable, "-m", "alembic", "current"],
        {"TRUSTYTRACK_DATA_DIR": str(tmp_path / ".trustytrack")},
    )

    assert result.returncode == 0, result.stderr


def test_cli_allows_the_escape_hatch(tmp_path):
    _seed_configured_database(tmp_path)

    result = _run(
        [sys.executable, "-m", "alembic", "current"],
        {"HOME": str(tmp_path), "TRUSTYTRACK_ALLOW_UNSAFE_MIGRATION": "1"},
    )

    assert result.returncode == 0, result.stderr


def test_init_db_is_never_refused_even_against_a_configured_database(tmp_path):
    """The app's own startup migration must be untouched by this guard.

    ``init_db()`` always hands `migrations/env.py` an already-open
    connection, which is what tells it apart from the CLI — see
    `_refuse_unsafe_cli_target`'s docstring. This runs it the same way
    `main.py`'s lifespan does: no `TRUSTYTRACK_DATA_DIR`, no escape hatch,
    against a database that already holds a configured organization.
    """
    _seed_configured_database(tmp_path)

    result = _init_db_with_home_only(tmp_path)

    assert result.returncode == 0, result.stderr
