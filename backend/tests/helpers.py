"""Shared helpers for the tests."""

import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _alembic(data_dir: Path, *args: str) -> subprocess.CompletedProcess:
    """Run the Alembic CLI against a given data directory.

    A subprocess because ``backend.db.database`` resolves its engine and paths
    at import time from the environment.
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
    reproduce.

    Hand-rolled minimal fixtures were what these tests used before, and they
    were a standing trap: a fixture that creates ``heats (id, lane_results)``
    passes until a migration touches a column it left out, and then fails in a
    way that looks like the migration is broken. Issue #32 was found the same
    way.

    Args:
        legacy_debug_mode: the column definition the old hand-rolled ALTER left
            on ``groups.debug_mode``, or None for an install where it never ran.
        seed: called with an open connection to insert rows.
    """
    db = tmp_path / "trusty-track.db"
    result = _alembic(tmp_path, "upgrade", "0001_baseline")
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        # Un-manage it: this is what a database from before migrations looks like.
        conn.execute(text("DROP TABLE alembic_version"))
        if legacy_debug_mode:
            conn.execute(
                text(f"ALTER TABLE groups ADD COLUMN debug_mode {legacy_debug_mode}")
            )
        if seed is not None:
            seed(conn)
    engine.dispose()
    return db


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
    """Dict literals from a test, as the ``Lane`` objects the free-race
    helpers in ``crud`` take.

    Those two used to ``json.dumps`` their argument, which is a second copy of
    the blob's codec in exactly the two places #72 has to change. They go
    through ``lanes.serialize`` now like every other write; this keeps the test
    call sites readable as the dict literals they always were.
    """
    from backend.domain import lanes

    return [lanes.from_dict(row, row["lane"]) for row in rows]
