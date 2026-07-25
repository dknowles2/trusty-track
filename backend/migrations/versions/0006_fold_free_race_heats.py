"""move free_race_heats into heats and drop the table

Issue #6, step two. ``0005`` gave ``heats`` the ``kind`` column and every reader
that needed it a filter; this moves the rows.

Two tables became one, so heat ids stop overlapping. That collision is what let
a free race result overwrite an official heat (issue #4), and it is why
``heat_lanes.heat_id`` could not be a foreign key. Both are fixed here: the
``kind`` discriminator comes off ``heat_lanes`` and the column becomes a real
reference.

The two blobs become one
------------------------
A free race heat stored its schedule in ``lane_assignments`` and its results in
``lane_results``, with the second null until the heat was run. An official heat
has always kept both in ``lane_results`` — the schedule written first with null
times, filled in afterwards. This adopts that shape, which is the whole point of
folding the tables: *"has this been run"* becomes one question with one answer,
asked of the lanes.

Revision ID: 0006_fold_free_heats
Revises: 0005_heat_kind
Create Date: 2026-07-25

"""

import json
import logging
from collections.abc import Sequence
from typing import Any, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_fold_free_heats"
down_revision: Union[str, Sequence[str], None] = "0005_heat_kind"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")


def _decode(raw: Any) -> list[dict]:
    """Lane entries from a blob, or [] for anything unreadable.

    Self-contained rather than importing ``backend.domain.lanes``: a migration
    has to keep producing the same result years from now, and wiring it to code
    that is still evolving would mean a past migration silently changing.
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


def _merge(assignments: Any, results: Any) -> str:
    """One blob from the two columns, keyed on lane.

    Where a lane appears in both, the result wins; a lane that was never run
    keeps its assignment, so the schedule is still visible. Same rule the
    ``heat_lanes`` backfill used, so the rows already in that table agree with
    what this writes.
    """
    merged: dict[Any, dict] = {}
    for entry in _decode(assignments):
        merged[entry.get("lane")] = entry
    for entry in _decode(results):
        merged[entry.get("lane")] = entry
    return json.dumps(list(merged.values()))


def _split(blob: Any) -> tuple[str, Union[str, None]]:
    """The inverse of :func:`_merge`, for the downgrade.

    ``lane_results`` is null unless something was timed — that is what the
    column meant, and what the old ``activeFreeRaceHeat`` query tested for.
    """
    lanes = _decode(blob)
    assignments = [
        {"lane": lane.get("lane"), "racer_id": lane.get("racer_id")} for lane in lanes
    ]
    has_times = any(lane.get("time") is not None for lane in lanes)
    return json.dumps(assignments), (json.dumps(lanes) if has_times else None)


def upgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())

    old_to_new: dict[int, int] = {}
    if "free_race_heats" in tables:
        rows = list(
            conn.execute(
                sa.text(
                    "SELECT id, race_id, lane_assignments, lane_results, created_at "
                    "FROM free_race_heats ORDER BY race_id, id"
                )
            )
        )
        # Free heats have no round, so heat_number is only a label. Numbering
        # per race in creation order keeps it meaningful.
        counters: dict[int, int] = {}
        for old_id, race_id, assignments, results, created_at in rows:
            counters[race_id] = counters.get(race_id, 0) + 1
            conn.execute(
                sa.text(
                    "INSERT INTO heats "
                    "(race_id, round_id, kind, heat_number, lane_results, created_at) "
                    "VALUES (:race_id, NULL, 'FREE', :number, :blob, :created_at)"
                ),
                {
                    "race_id": race_id,
                    "number": counters[race_id],
                    "blob": _merge(assignments, results),
                    "created_at": created_at,
                },
            )
            old_to_new[old_id] = conn.execute(
                sa.text("SELECT last_insert_rowid()")
            ).scalar()
        logger.info("folded %d free race heats into heats", len(rows))

    if "heat_lanes" in tables:
        for old_id, new_id in old_to_new.items():
            conn.execute(
                sa.text(
                    "UPDATE heat_lanes SET heat_id = :new_id "
                    "WHERE kind = 'FREE' AND heat_id = :old_id"
                ),
                {"new_id": new_id, "old_id": old_id},
            )
        # A foreign key cannot be added over a dangling reference. Nothing
        # should produce one, but this table predates the sync listener that
        # cascades heat deletions, so make sure rather than fail the upgrade.
        orphans = conn.execute(
            sa.text(
                "DELETE FROM heat_lanes WHERE heat_id NOT IN (SELECT id FROM heats)"
            )
        ).rowcount
        if orphans:
            logger.warning("dropped %d heat_lanes rows with no heat", orphans)

        with op.batch_alter_table("heat_lanes", schema=None) as batch_op:
            batch_op.drop_index(batch_op.f("ix_heat_lanes_kind"))
            batch_op.drop_column("kind")
            batch_op.create_foreign_key(
                "fk_heat_lanes_heat_id", "heats", ["heat_id"], ["id"]
            )

    if "free_race_heats" in tables:
        op.drop_table("free_race_heats")


def downgrade() -> None:
    """Split the table back apart.

    Faithful but not byte-identical: ids are reassigned, and a free heat that
    was created and never run comes back with ``lane_results`` null, which is
    what that column meant.
    """
    op.create_table(
        "free_race_heats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("race_id", sa.Integer(), nullable=False),
        sa.Column("lane_assignments", sa.String(), nullable=False),
        sa.Column("lane_results", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["race_id"], ["races.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("free_race_heats", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_free_race_heats_id"), ["id"], unique=False)

    with op.batch_alter_table("heat_lanes", schema=None) as batch_op:
        batch_op.drop_constraint("fk_heat_lanes_heat_id", type_="foreignkey")
        batch_op.add_column(
            sa.Column(
                "kind",
                sa.Enum("OFFICIAL", "FREE", name="heatkind"),
                server_default="OFFICIAL",
                nullable=False,
            )
        )
        batch_op.create_index(batch_op.f("ix_heat_lanes_kind"), ["kind"], unique=False)

    conn = op.get_bind()
    rows = list(
        conn.execute(
            sa.text(
                "SELECT id, race_id, lane_results, created_at FROM heats "
                "WHERE kind = 'FREE' ORDER BY id"
            )
        )
    )
    for heat_id, race_id, blob, created_at in rows:
        assignments, results = _split(blob)
        conn.execute(
            sa.text(
                "INSERT INTO free_race_heats "
                "(race_id, lane_assignments, lane_results, created_at) "
                "VALUES (:race_id, :assignments, :results, :created_at)"
            ),
            {
                "race_id": race_id,
                "assignments": assignments,
                "results": results,
                "created_at": created_at or "",
            },
        )
        new_id = conn.execute(sa.text("SELECT last_insert_rowid()")).scalar()
        conn.execute(
            sa.text(
                "UPDATE heat_lanes SET kind = 'FREE', heat_id = :new_id "
                "WHERE heat_id = :heat_id"
            ),
            {"new_id": new_id, "heat_id": heat_id},
        )

    conn.execute(sa.text("DELETE FROM heats WHERE kind = 'FREE'"))
