"""give heat_lanes' foreign keys ON DELETE actions

Issue #125. Enforcement is on now, and the moment it was, four delete paths in
``crud.py`` turned out to remove a parent while lane rows still point at it:

- ``delete_heat`` and ``delete_round`` emit ``DELETE FROM heats`` while
  ``lane_sync`` is still waiting for ``after_flush`` to clear the lanes — which
  is *after* the statement the database now refuses;
- ``bulk_delete_racers`` deletes the racers and only then calls
  ``_remove_racer_from_regular_heats`` / ``_remove_racer_from_free_heats`` to
  null the references;
- ``delete_race`` deletes the race's racers before its heats.

Each was correct only because nothing was checking. Fixing them by reordering
four call sites would leave the constraint depending on every future caller
remembering; ``ON DELETE`` puts the rule where the relationship is.

``racer_id`` sets null, which is the clause issue #72 step 4 wants and the
thing the two ``_remove_racer_from_*`` helpers hand-roll. They still run —
they also rewrite the ``lane_results`` blob the table is projected alongside —
but they no longer have to run *first*.

``heat_id`` cascades. A lane has no meaning without its heat, and ``lane_sync``
was already doing exactly this in Python.

Existing orphans are cleaned first
----------------------------------
A database written while enforcement was off may already hold rows this
constraint forbids — that is what the bugs above produced. ``ON DELETE`` says
nothing about rows that are already wrong, and the table rebuild below would
carry them across, so they are repaired here and the counts logged. Same
treatment 0006 gave orphaned ``heat_id`` values for the same reason.

Revision ID: 0010_heat_lanes_on_delete
Revises: 0009_track_remote_start
Create Date: 2026-08-06

"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_heat_lanes_on_delete"
down_revision: str | Sequence[str] | None = "0009_track_remote_start"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

#: The table as it stands, minus its foreign keys.
#:
#: Handed to ``batch_alter_table`` as ``copy_from`` so the rebuild works from
#: this rather than from reflection. Omitting the constraints is what drops
#: them: the racer key was created inline and unnamed, and SQLite cannot drop an
#: unnamed constraint by name.
#:
#: The indexes have to be listed even though they are not changing. ``copy_from``
#: replaces reflection entirely, so anything absent from this definition is
#: absent from the rebuilt table — and a silently dropped index is the kind of
#: thing that shows up as a slow race day rather than as an error.
HEAT_LANES = sa.Table(
    "heat_lanes",
    sa.MetaData(),
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("heat_id", sa.Integer(), nullable=False),
    sa.Column("lane", sa.Integer(), nullable=False),
    sa.Column("racer_id", sa.Integer(), nullable=True),
    sa.Column("placeholder_slot", sa.Integer(), nullable=True),
    sa.Column("time_seconds", sa.Float(), nullable=True),
    sa.Column("place", sa.Integer(), nullable=True),
    sa.Column("skipped", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    sa.PrimaryKeyConstraint("id"),
    sa.Index("ix_heat_lanes_heat_id", "heat_id"),
    sa.Index("ix_heat_lanes_id", "id"),
)


def _repair_orphans() -> None:
    conn = op.get_bind()

    nulled = conn.execute(
        sa.text(
            "UPDATE heat_lanes SET racer_id = NULL "
            "WHERE racer_id IS NOT NULL "
            "AND racer_id NOT IN (SELECT id FROM racers)"
        )
    ).rowcount
    if nulled:
        logger.warning("cleared %d heat_lanes rows naming a deleted racer", nulled)

    dropped = conn.execute(
        sa.text("DELETE FROM heat_lanes WHERE heat_id NOT IN (SELECT id FROM heats)")
    ).rowcount
    if dropped:
        logger.warning("dropped %d heat_lanes rows with no heat", dropped)


def upgrade() -> None:
    _repair_orphans()
    with op.batch_alter_table(
        "heat_lanes", copy_from=HEAT_LANES, schema=None
    ) as batch_op:
        batch_op.create_foreign_key(
            "fk_heat_lanes_heat_id", "heats", ["heat_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_foreign_key(
            "fk_heat_lanes_racer_id",
            "racers",
            ["racer_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Back to foreign keys with no ``ON DELETE`` action.

    The rows are left as they are: the repair above is not reversible, and a
    lane whose racer has been deleted is better held as null than restored to
    naming somebody who is not there.
    """
    with op.batch_alter_table(
        "heat_lanes", copy_from=HEAT_LANES, schema=None
    ) as batch_op:
        batch_op.create_foreign_key(
            "fk_heat_lanes_heat_id", "heats", ["heat_id"], ["id"]
        )
        batch_op.create_foreign_key(
            "fk_heat_lanes_racer_id", "racers", ["racer_id"], ["id"]
        )
