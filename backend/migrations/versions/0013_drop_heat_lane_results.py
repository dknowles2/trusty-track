"""drop heats.lane_results, keeping anything heat_lanes cannot express

Issue #72, step 5. `heat_lanes` has been the source of truth for every read
since #123/#124, and `lane_results` has been a *derived* column since #120 —
written alongside so a rollback had data while the readers moved one at a time.
This drops it.

The column is the only copy of anything the table does not model, so dropping
it is the one irreversible act in this work. Rather than gate that on a release
having shipped — a calendar, not a check — this migration **proves losslessness
on the database in front of it**. Every blob is rebuilt from `heat_lanes` and
compared against what is stored; a heat that does not round-trip has its
original blob copied into `heat_lane_blob_archive` before the column goes.

What round-trips, established by testing a database holding every convention
`v1.0.0` could produce:

* results, skipped heats, unadvanced placeholders and vacated lanes — exactly;
* a time stored as the string ``"3.900"`` — as ``3.9``, the same value, and
  ``v1.0.0`` typed the field ``number | string``;
* lane order — normalised, and the lane number is explicit, so it carries
  nothing.

What does not, and is therefore archived:

* a time that is not a number at all (``"DNF"``), which `heat_lanes` stored as
  NULL — the blob has been the only copy since the upgrade that created the
  table;
* any key no version of this application ever wrote, which is what
  `lanes.carry_extras` was protecting;
* a heat whose blob was unreadable, which produced no lane rows at all.

The archive is expected to be empty. An empty table is the evidence that this
install's drop was clean; a non-empty one is the operator's data, kept.

Deliberately **not** a failure. `init_db()` runs at startup, so raising here
would stop an operator's system from booting — plausibly on the morning of an
event — over a historical heat's time text. Preserving and continuing is the
right trade.

Revision ID: 0013_drop_lane_results
Revises: 0012_debug_mode_default
Create Date: 2026-08-08

"""

import json
import logging
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0013_drop_lane_results"
down_revision: str | Sequence[str] | None = "0012_debug_mode_default"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# Self-contained, like `0003`. A migration that imports the application's codec
# breaks when the codec changes — and this one deletes it.
_KNOWN_KEYS = ("lane", "racer_id", "time", "place")


def _decode(raw: Any) -> list[dict] | None:
    """Lane entries from a blob, or None for anything unreadable."""
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(value, list):
        return None
    return [item for item in value if isinstance(item, dict)]


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _rebuild(rows: Sequence[Any]) -> list[dict]:
    """The blob `heat_lanes` rows encode, in the shape the column held.

    The inverse of `0003`'s projection: a placeholder slot goes back to a
    negative racer id, and `skipped` returns as a key rather than a column.
    """
    out = []
    for row in rows:
        entry: dict[str, Any] = {
            "lane": row.lane,
            "racer_id": -row.placeholder_slot
            if row.placeholder_slot is not None
            else row.racer_id,
            "time": row.time_seconds,
            "place": row.place,
        }
        if row.skipped:
            entry["skipped"] = True
        out.append(entry)
    return out


def _equivalent(stored: list[dict], rebuilt: list[dict]) -> bool:
    """Whether the rebuilt blob carries everything the stored one did.

    Compared by lane rather than by position, and times by *value* rather than
    by type — `"3.900"` and `3.9` are the same time, and every reader coerced
    them. A key the rebuild does not carry counts as a difference, which is the
    whole point: those are the ones with nowhere else to live.
    """
    if len(stored) != len(rebuilt):
        return False

    by_lane = {entry.get("lane"): entry for entry in rebuilt}
    for entry in stored:
        other = by_lane.get(entry.get("lane"))
        if other is None:
            return False
        for key, value in entry.items():
            if key == "time":
                if _as_float(value) != _as_float(other.get("time")):
                    return False
                # A time that is not a number at all survives nowhere else.
                if value is not None and _as_float(value) is None:
                    return False
            elif key == "skipped":
                if bool(value) != bool(other.get("skipped")):
                    return False
            elif key in _KNOWN_KEYS:
                if value != other.get(key):
                    return False
            else:
                # A key nothing models. `heat_lanes` never held it.
                return False
    return True


def upgrade() -> None:
    op.create_table(
        "heat_lane_blob_archive",
        sa.Column("heat_id", sa.Integer(), nullable=False),
        sa.Column("lane_results", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("heat_id"),
    )

    bind = op.get_bind()
    heats = bind.execute(sa.text("SELECT id, lane_results FROM heats")).fetchall()
    lane_rows: dict[int, list] = {}
    for row in bind.execute(
        sa.text(
            "SELECT heat_id, lane, racer_id, placeholder_slot, time_seconds, place,"
            " skipped FROM heat_lanes ORDER BY heat_id, lane"
        )
    ):
        lane_rows.setdefault(row.heat_id, []).append(row)

    archived = 0
    for heat in heats:
        stored = _decode(heat.lane_results)
        rebuilt = _rebuild(lane_rows.get(heat.id, []))
        if stored is not None and _equivalent(stored, rebuilt):
            continue
        bind.execute(
            sa.text(
                "INSERT INTO heat_lane_blob_archive (heat_id, lane_results)"
                " VALUES (:heat_id, :lane_results)"
            ),
            {"heat_id": heat.id, "lane_results": heat.lane_results},
        )
        archived += 1

    if archived:
        logger.warning(
            "dropping heats.lane_results: %s of %s heats could not be rebuilt from "
            "heat_lanes; their original blobs are in heat_lane_blob_archive",
            archived,
            len(heats),
        )

    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.drop_column("lane_results")


def downgrade() -> None:
    """Put the column back, rebuilt from `heat_lanes`.

    Lossless for everything the table models, and the archive restores what it
    does not — so a database that goes down and back up again holds what it
    started with.
    """
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.add_column(sa.Column("lane_results", sa.String(), nullable=True))

    bind = op.get_bind()
    lane_rows: dict[int, list] = {}
    for row in bind.execute(
        sa.text(
            "SELECT heat_id, lane, racer_id, placeholder_slot, time_seconds, place,"
            " skipped FROM heat_lanes ORDER BY heat_id, lane"
        )
    ):
        lane_rows.setdefault(row.heat_id, []).append(row)

    archive = {
        row.heat_id: row.lane_results
        for row in bind.execute(
            sa.text("SELECT heat_id, lane_results FROM heat_lane_blob_archive")
        )
    }

    for heat in bind.execute(sa.text("SELECT id FROM heats")):
        blob = archive.get(heat.id)
        if blob is None:
            blob = json.dumps(_rebuild(lane_rows.get(heat.id, [])))
        bind.execute(
            sa.text("UPDATE heats SET lane_results = :blob WHERE id = :id"),
            {"blob": blob, "id": heat.id},
        )

    op.drop_table("heat_lane_blob_archive")
