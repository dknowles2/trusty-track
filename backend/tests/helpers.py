"""Shared helpers for the tests."""

import functools
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text

from backend.db.database import init_db

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def run_alembic(data_dir: Path, *args: str) -> subprocess.CompletedProcess:
    """Run the Alembic CLI against a given data directory.

    A subprocess because this is the CLI — the entry point with its own
    argument parsing and its own refusal guard (``migrations/env.py``'s
    ``_refuse_unsafe_cli_target``), neither of which is reachable from inside
    this process. Tests that only want a database at head should call
    ``migrate_to_head`` instead; a subprocess there buys nothing and costs an
    interpreter start plus a full backend import every time.
    """
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


def migrate_to_head(data_dir: Path) -> Path:
    """Migrate ``data_dir``'s database to head, the way an operator's install does.

    This is ``init_db()`` itself — the same legacy detection, the same stamp,
    the same upgrade — pointed at another engine rather than re-implemented.
    It used to be a subprocess, because ``init_db`` could only ever migrate the
    module-level engine resolved from the environment at import time, so a
    second database meant a second interpreter. That cost about 0.9s per call
    against roughly 0.3s of actual migrating, and it was paid once per test
    across four files, which is what put these tests at the top of
    ``--durations``.

    Raises whatever the migration raises, which is the point: a failure now
    arrives as a traceback in the test that caused it, instead of a returncode
    and a captured stderr string the caller had to remember to assert on.
    """
    database = data_dir / "trusty-track.db"
    engine = create_engine(
        f"sqlite:///{database}", connect_args={"check_same_thread": False}
    )
    try:
        init_db(engine)
    finally:
        # `init_db` disposes it on the way out; this covers the failure path.
        engine.dispose()
    return database


@functools.cache
def _baseline_file() -> bytes:
    """The pre-Alembic schema as a SQLite file, built once per process.

    Every caller of ``build_pre_alembic_database`` wants the same bytes: the
    baseline schema with ``alembic_version`` removed, before any seed runs.
    Building it took a full Alembic run per test; copying it takes a
    ``write_bytes``. Cached on the function rather than in a fixture so the
    helper stays callable from anywhere, including from module scope.

    Built through ``_alembic_config`` rather than a config of its own so there
    is one answer to where the migrations live and how they are configured,
    with the connection handed in through ``config.attributes`` exactly as
    ``init_db`` does it — which is also the branch of ``migrations/env.py``
    that skips the CLI refusal guard.
    """
    from alembic import command

    from backend.db import database as database_module

    with tempfile.TemporaryDirectory() as scratch:
        database = Path(scratch) / "trusty-track.db"
        engine = create_engine(f"sqlite:///{database}")
        try:
            with engine.begin() as connection:
                config = database_module._alembic_config()
                config.attributes["connection"] = connection
                command.upgrade(config, "0001_baseline")
            with engine.begin() as connection:
                # Un-manage it: this is what a database from before migrations
                # looks like.
                connection.execute(text("DROP TABLE alembic_version"))
        finally:
            engine.dispose()
        return database.read_bytes()


def build_pre_alembic_database(
    tmp_path: Path,
    *,
    legacy_debug_mode: str | None = None,
    seed: Callable | None = None,
) -> Path:
    """A database as the pre-Alembic ``create_all()`` would have left it.

    Built by running the baseline migration and then removing
    ``alembic_version``, rather than by hand. ``0001_baseline`` *is* the schema
    ``create_all()`` produced, so this cannot drift from what it claims to
    reproduce. That run happens once per process and the resulting file is
    copied here (see ``_baseline_file``) — it takes no arguments and reads no
    state, so every call was producing the same bytes at the same cost.

    Hand-rolled minimal fixtures were what these tests used before, and they
    were a standing trap: a fixture that creates ``heats (id, lane_results)``
    passes until a migration touches a column it left out, and then fails in a
    way that looks like the migration is broken. Issue #32 was found the same
    way.

    Args:
        legacy_debug_mode: the column definition ``groups.debug_mode`` was left
            with, or None for a database that has no such column at all.
        seed: called with an open connection to insert rows.
    """
    db = tmp_path / "trusty-track.db"
    db.write_bytes(_baseline_file())

    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        if legacy_debug_mode:
            _add_legacy_debug_mode(conn, legacy_debug_mode)
        if seed is not None:
            seed(conn)
    engine.dispose()
    return db


def _add_legacy_debug_mode(conn: Any, definition: str) -> None:
    """Put ``groups.debug_mode`` on the table the way a legacy install got it.

    Two mechanisms produced the column before Alembic, and they left different
    schemas — which is the whole subject of issue #32:

    * the hand-rolled ``ALTER TABLE`` in the old ``init_db()``, on a database
      predating the column entirely;
    * ``create_all()``, on any install from a version whose model already had
      it — which is every ``v1.0.0`` install, since ``create_all()`` runs first
      and the ALTER then finds nothing to do.

    The second shape cannot be reached by ALTER at all: SQLite rejects adding a
    NOT NULL column with no default. So it is built the way ``create_all()``
    built it, inline in the ``CREATE TABLE``.
    """
    if "NOT NULL" in definition and "DEFAULT" not in definition:
        # Dropped and rebuilt rather than renamed: SQLite rewrites referencing
        # foreign keys to follow a `RENAME TO`, so `races.group_id` would end up
        # pointing at the temporary name. The table is empty at this point —
        # `seed` has not run — so there is nothing to carry across.
        conn.execute(text("DROP TABLE groups"))
        conn.execute(
            text(
                "CREATE TABLE groups ("
                " id INTEGER NOT NULL,"
                " name VARCHAR NOT NULL,"
                f" debug_mode {definition},"
                " PRIMARY KEY (id))"
            )
        )
        conn.execute(text("CREATE UNIQUE INDEX ix_groups_name ON groups (name)"))
        conn.execute(text("CREATE INDEX ix_groups_id ON groups (id)"))
        return

    conn.execute(text(f"ALTER TABLE groups ADD COLUMN debug_mode {definition}"))


UPDATE_HEAT_RESULT = """
mutation UpdateHeatResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  updateHeatResult(heatId: $heatId, lanes: $lanes) { id }
}
"""

RECORD_FREE_RACE_RESULT = """
mutation RecordFreeRaceResult($heatId: Int!, $lanes: [HeatLaneInput!]!) {
  recordFreeRaceResult(heatId: $heatId, lanes: $lanes) {
    id
    recorded
    lanes { lane racerId time place }
  }
}
"""


def lane_input(entry: dict[str, Any]) -> dict[str, Any]:
    """A ``lane_results`` blob entry as ``HeatLaneInput``.

    Most of these tests build a heat's lanes in the blob's shape because that is
    what the fixtures and `crud` still use. This converts one, including the
    negative-id placeholder encoding the input replaced.
    """
    racer_id = entry.get("racer_id")
    placeholder = -racer_id if racer_id is not None and racer_id < 0 else None
    time = entry.get("time")
    return {
        "lane": entry["lane"],
        "racerId": None if placeholder is not None or racer_id is None else racer_id,
        "placeholderSlot": placeholder,
        "time": float(time) if time is not None else None,
        "place": entry.get("place"),
        "skipped": bool(entry.get("skipped")),
    }


def record_heat_result(client, heat_id: int, entries: list[dict]) -> dict:
    """Record a heat's results through the GraphQL mutation."""
    response = client.post(
        "/graphql",
        json={
            "query": UPDATE_HEAT_RESULT,
            "variables": {
                "heatId": heat_id,
                "lanes": [lane_input(entry) for entry in entries],
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body["errors"]
    return body["data"]


def as_lanes(rows: list[dict]) -> list[Any]:
    """Dict literals from a test, as the ``Lane`` objects ``crud`` takes.

    Kept after the blob went (#72) because the dict literal is still the most
    readable way to write a heat's lanes in a test — it is just no longer a
    storage format. Builds ``Lane`` directly rather than going through a codec,
    since there is none.

    A negative ``racer_id`` still means an unadvanced championship slot, which
    is what ``Lane`` holds internally.
    """
    from backend.domain import lanes

    out = []
    for row in rows:
        racer_id = row.get("racer_id")
        # A negative id is still how a test writes an unadvanced championship
        # slot — it is compact and every fixture here already used it. It is a
        # *fixture* convention now rather than a storage one (#164): `Lane`
        # carries the slot in its own field, so the translation happens here.
        placeholder = -racer_id if racer_id is not None and racer_id < 0 else None
        out.append(
            lanes.Lane(
                lane=row["lane"],
                racer_id=None if placeholder is not None else racer_id,
                placeholder_slot=placeholder,
                time=row.get("time"),
                place=row.get("place"),
                skipped=bool(row.get("skipped")),
            )
        )
    return out


def add_heat(db: Any, heat: Any, rows: list[dict]) -> Any:
    """A heat and its lanes, the way production writes them.

    Tests used to pass ``lane_results=json.dumps([...])`` to the constructor.
    With the column gone (#72) lanes go through ``crud.set_heat_lanes`` — which
    stages them for the listener, so the heat needs to be in the session first
    and the id arrives on flush.
    """
    from backend.db import crud

    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(rows))
    db.commit()
    return heat


def lane_dicts(db: Any, heat: Any) -> list[dict]:
    """A heat's lanes as the dict shape tests have always asserted against.

    Replaces `json.loads(heat.lane_results)`. The column is gone (#72); the
    lanes come off `heat_lanes`, and the dicts are rebuilt here so the
    assertions around them did not all have to change at once. A placeholder is
    a negative ``racer_id``, as the blob had it and as ``Lane`` still holds it.
    """
    from backend.db import crud

    out = []
    for lane in crud.heat_lanes_of(db, heat):
        entry: dict = {
            "lane": lane.lane,
            "racer_id": -lane.placeholder_slot
            if lane.placeholder_slot is not None
            else lane.racer_id,
            "time": lane.time,
            "place": lane.place,
        }
        if lane.skipped:
            entry["skipped"] = True
        out.append(entry)
    return out
