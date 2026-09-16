"""``SchedulingAlgorithm.PERFECT_N`` (#1090, part C).

Widens `rounds.scheduling_algorithm`'s enum to accept `PERFECT_N`, alongside
`PPC` and `ROTATION` (`0054_round_scheduling_algorithm`). Purely additive —
no round created before this migration can already hold the value, so there
is no data to rewrite going up.

Nullable and untouched otherwise: `crud.round_algorithm` still resolves a
null column to `PPC`, and `PERFECT_N` is simply one more string that column
can hold, exactly the widen `0053_general_round_format` used for
`SchedulingStrategy` (there with a rewrite step, because that migration
renamed a value in place; here there is nothing stored at the old name to
rename).

The downgrade narrows back to `('PPC', 'ROTATION')`, so it must handle any
round already stamped `PERFECT_N` — as `0053`'s downgrade rewrote `GENERAL`
back to `PPC`, this rewrites `PERFECT_N` back to `NULL`, which
`crud.round_algorithm` reads as `PPC`, the same fallback every round created
before this migration already gets. A rebuild is not the same as the
Perfect-N chart the round was actually scheduled with, but a downgrade path
that cannot express this migration's own new value has to pick something,
and the existing null-means-PPC default is the least surprising answer —
better than leaving a column value the narrowed enum's `CHECK` constraint
would then reject outright.

Revision ID: 0055_perfect_n_algorithm
Revises: 0054_round_scheduling_algorithm
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0055_perfect_n_algorithm"
down_revision: str | Sequence[str] | None = "0054_round_scheduling_algorithm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Widen the enum to accept ``PERFECT_N``. Nothing to rewrite."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_algorithm",
            existing_type=sa.Enum("PPC", "ROTATION", name="schedulingalgorithm"),
            type_=sa.Enum("PPC", "ROTATION", "PERFECT_N", name="schedulingalgorithm"),
            existing_nullable=True,
        )


def downgrade() -> None:
    """Rewrite any ``PERFECT_N`` round to ``NULL`` (reads back as ``PPC``),
    then narrow the enum back down."""
    op.execute(
        "UPDATE rounds SET scheduling_algorithm = NULL"
        " WHERE scheduling_algorithm = 'PERFECT_N'"
    )
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_algorithm",
            existing_type=sa.Enum(
                "PPC", "ROTATION", "PERFECT_N", name="schedulingalgorithm"
            ),
            type_=sa.Enum("PPC", "ROTATION", name="schedulingalgorithm"),
            existing_nullable=True,
        )
