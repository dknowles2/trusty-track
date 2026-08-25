"""Balanced rounds.

Adds the BALANCED scheduling strategy — phase-by-phase racing where each
phase matches cars with similar records — and the one number it needs: how
many phases the round runs. The enum widening matters for the same reason
0021's did: the adopted-database test compares reflected types attribute by
attribute against a fresh install.

Revision ID: 0022_balanced_rounds
Revises: 0021_elimination_rounds
Create Date: 2026-08-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0022_balanced_rounds"
down_revision: str | Sequence[str] | None = "0021_elimination_rounds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the phase count and widen the strategy enum."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("balanced_phases", sa.Integer(), nullable=True))
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum("PPC", "ELIMINATION", name="schedulingstrategy"),
            type_=sa.Enum("PPC", "ELIMINATION", "BALANCED", name="schedulingstrategy"),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Drop the phase count and narrow the enum back."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum(
                "PPC", "ELIMINATION", "BALANCED", name="schedulingstrategy"
            ),
            type_=sa.Enum("PPC", "ELIMINATION", name="schedulingstrategy"),
            existing_nullable=False,
        )
        batch_op.drop_column("balanced_phases")
