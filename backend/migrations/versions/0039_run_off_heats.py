"""Run-off heats: ``heats.settles_round_id`` (#550).

Two changes, only one of which is a schema change. ``HeatKind`` gains a third
member, ``RUN_OFF`` — a no-op here for the same reason ``0027_no_timer_type``
recorded one for ``TimerType.NONE``: ``kind`` is ``SAEnum(HeatKind)`` with no
``create_constraint``, so SQLite holds it as a plain column and a new member
changes nothing a migration can see. It is not even a width change:
``sa.Enum`` renders a SQLite-backed column as a ``VARCHAR`` sized to its
longest member, and ``"RUN_OFF"`` (7 characters) is shorter than the existing
``"OFFICIAL"`` (8), so the reflected type is unchanged too.

``settles_round_id`` is the real change: which round's standings a run-off
heat is racing to decide, or null for the race's own overall standings. See
the column's docstring in ``models.py`` for why it is not the same column as
``round_id`` — a run-off is not a slot in that round's *schedule*, and every
piece of code that rebuilds, renumbers or counts a round's heats assumes its
heats are exactly the ones it generated.

``ON DELETE CASCADE``: a run-off with nothing left to settle is not worth
keeping, the same "deletion is the schema's job" rule #125 gave
``heat_lanes``. Existing rows all get null, which is correct — no run-off
heats exist before this migration, since the mutation that creates them does
not either.

Revision ID: 0039_run_off_heats
Revises: 0038_vehicle_artwork_key
Create Date: 2026-08-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039_run_off_heats"
down_revision: str | Sequence[str] | None = "0038_vehicle_artwork_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.add_column(sa.Column("settles_round_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_heats_settles_round_id",
            "rounds",
            ["settles_round_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    """Drop the column.

    Any `RUN_OFF`-kind heat rows are left in place, minus the column naming
    which round they settled — the same trade `0027_no_timer_type` leaves for
    a `NONE`-typed track: the enum member is not removed by this migration
    (it costs no schema change either way, see the module docstring), so the
    rows are not orphaned in a way that breaks anything reading them. Their
    *consequence* was always computed on every read rather than stored
    (#550's rule 4), so there is no derived data anywhere else to unwind.
    """
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.drop_constraint("fk_heats_settles_round_id", type_="foreignkey")
        batch_op.drop_column("settles_round_id")
