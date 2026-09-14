"""``SchedulingStrategy.PPC`` renamed to ``GENERAL`` (#1090, part A).

`SchedulingStrategy` is a round's *format* — how it is raced — and its three
values are ``GENERAL``, ``ELIMINATION``, ``BALANCED``. The first was
misnamed: it means "the ordinary general/qualifying round", and PPC (the
Partial Perfect Chart, `domain/scheduling.py`) is merely the *algorithm* that
currently builds it. #1090 splits that algorithm into its own seam
(`SchedulingAlgorithm`, a later part of the epic), and leaving the format
called ``PPC`` would make "a PPC-format round scheduled with the Perfect-N
algorithm" a sentence the code has to say once that seam exists.

Three steps, the same shape `0021_elimination_rounds.py` and
`0022_balanced_rounds.py` used to grow this same enum: widen the column to
accept both the old and new spellings, rewrite the stored data, then narrow
back down to the three current values. The widen/narrow pair costs nothing
here — ``ELIMINATION`` was and remains the longest member, so the reflected
``VARCHAR`` length is unchanged either way — but it is kept anyway so the enum
`models.py` declares and the one the database's own type carries never
silently disagree, the same reasoning those two migrations gave for it
mattering "even on SQLite".

Revision ID: 0053_general_round_format
Revises: 0052_round_runs_per_lane
Create Date: 2026-09-13

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0053_general_round_format"
down_revision: str | Sequence[str] | None = "0052_round_runs_per_lane"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Widen, rewrite ``PPC`` rows to ``GENERAL``, then narrow."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum(
                "PPC", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            type_=sa.Enum(
                "PPC", "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            existing_nullable=False,
        )
    op.execute(
        "UPDATE rounds SET scheduling_strategy = 'GENERAL'"
        " WHERE scheduling_strategy = 'PPC'"
    )
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum(
                "PPC", "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            type_=sa.Enum(
                "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Widen, rewrite ``GENERAL`` rows back to ``PPC``, then narrow."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum(
                "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            type_=sa.Enum(
                "PPC", "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            existing_nullable=False,
        )
    op.execute(
        "UPDATE rounds SET scheduling_strategy = 'PPC'"
        " WHERE scheduling_strategy = 'GENERAL'"
    )
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum(
                "PPC", "GENERAL", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            type_=sa.Enum("PPC", "ELIMINATION", "BALANCED", name="schedulingstrategy"),
            existing_nullable=False,
        )
