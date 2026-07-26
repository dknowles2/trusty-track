"""add heat_lanes table and backfill it from the lane_results blobs

Issue #5. Creates the normalized table and populates it from the existing JSON
blobs. **Nothing reads it yet** — ``lane_results`` remains the source of truth
until a later change switches the readers over. That makes this migration
reversible with no data loss: the downgrade simply drops the table.

The parsing here is deliberately self-contained rather than importing
``backend.domain.lanes``. A migration has to keep producing the same result
years from now; wiring it to code that is still evolving would mean a past
migration silently changing behaviour.

Revision ID: 0003_heat_lanes
Revises: 0002_debug_mode
Create Date: 2026-07-25

"""

import json
import logging
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0003_heat_lanes"
down_revision: str | Sequence[str] | None = "0002_debug_mode"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")


def _decode(raw: Any) -> list[dict]:
    """Lane entries from a blob, or [] for anything unreadable.

    Real databases contain the literal string ``'null'`` in
    ``free_race_heats.lane_results``, alongside SQL NULL and proper arrays.
    A heat we cannot read becomes a heat with no lanes rather than a failed
    upgrade — an install that will not start is worse than a heat that shows
    as unraced.
    """
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _as_float(value: Any) -> float | None:
    """The blob stored times as floats or strings depending on who wrote them."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row(heat_id: int, kind: str, entry: dict, known_racers: set) -> dict:
    """One blob entry as a heat_lanes row."""
    racer_id = entry.get("racer_id")
    placeholder_slot = None

    if racer_id is not None and racer_id < 0:
        # The blob encoded unadvanced championship slots as negative ids.
        placeholder_slot = abs(racer_id)
        racer_id = None
    elif racer_id is not None and racer_id not in known_racers:
        # No foreign key ever guarded the blob, so it can name a deleted racer.
        # Adding the FK now means dropping the reference rather than failing.
        logger.warning(
            "heat_lanes backfill: heat %s (%s) lane %s references unknown racer "
            "%s; storing an empty lane",
            heat_id,
            kind,
            entry.get("lane"),
            racer_id,
        )
        racer_id = None

    return {
        "heat_id": heat_id,
        "kind": kind,
        "lane": entry.get("lane"),
        "racer_id": racer_id,
        "placeholder_slot": placeholder_slot,
        "time_seconds": _as_float(entry.get("time")),
        "place": entry.get("place"),
        "skipped": bool(entry.get("skipped")),
    }


def upgrade() -> None:
    op.create_table(
        "heat_lanes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("heat_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Enum("OFFICIAL", "FREE", name="heatkind"), nullable=False),
        sa.Column("lane", sa.Integer(), nullable=False),
        sa.Column("racer_id", sa.Integer(), nullable=True),
        sa.Column("placeholder_slot", sa.Integer(), nullable=True),
        sa.Column("time_seconds", sa.Float(), nullable=True),
        sa.Column("place", sa.Integer(), nullable=True),
        sa.Column("skipped", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(["racer_id"], ["racers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("heat_lanes", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_heat_lanes_heat_id"), ["heat_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_heat_lanes_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_heat_lanes_kind"), ["kind"], unique=False)

    _backfill()


def _backfill() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())

    # A pre-Alembic database is stamped at the baseline and then migrated
    # forward, and not every one of those has every table — some predate free
    # racing entirely. A backfill with no source is a no-op, not a failure.
    known_racers = (
        {r[0] for r in conn.execute(sa.text("SELECT id FROM racers"))}
        if "racers" in tables
        else set()
    )
    rows: list[dict] = []

    if "heats" in tables:
        for heat_id, blob in conn.execute(
            sa.text("SELECT id, lane_results FROM heats")
        ):
            for entry in _decode(blob):
                rows.append(_row(heat_id, "OFFICIAL", entry, known_racers))

    # Free race splits the schedule and the results across two columns. The
    # results carry the same lane->racer map plus times, so where a lane appears
    # in both, the result wins; lanes that were never run come from assignments.
    if "free_race_heats" in tables:
        for heat_id, assignments, results in conn.execute(
            sa.text("SELECT id, lane_assignments, lane_results FROM free_race_heats")
        ):
            merged: dict[Any, dict] = {}
            for entry in _decode(assignments):
                merged[entry.get("lane")] = entry
            for entry in _decode(results):
                merged[entry.get("lane")] = entry
            for entry in merged.values():
                rows.append(_row(heat_id, "FREE", entry, known_racers))

    if not rows:
        return

    heat_lanes = sa.table(
        "heat_lanes",
        sa.column("heat_id", sa.Integer),
        sa.column("kind", sa.String),
        sa.column("lane", sa.Integer),
        sa.column("racer_id", sa.Integer),
        sa.column("placeholder_slot", sa.Integer),
        sa.column("time_seconds", sa.Float),
        sa.column("place", sa.Integer),
        sa.column("skipped", sa.Boolean),
    )
    op.bulk_insert(heat_lanes, rows)
    logger.info("heat_lanes backfill: inserted %d rows", len(rows))


def downgrade() -> None:
    """Drop the table.

    Lossless: `lane_results` was never modified, so it is still the source of
    truth for every heat.
    """
    with op.batch_alter_table("heat_lanes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_heat_lanes_kind"))
        batch_op.drop_index(batch_op.f("ix_heat_lanes_id"))
        batch_op.drop_index(batch_op.f("ix_heat_lanes_heat_id"))
    op.drop_table("heat_lanes")
