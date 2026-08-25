"""Ladderless elimination rounds.

Adds the ELIMINATION scheduling strategy and the one number it needs: how
many heats a car may lose before it is out. The column is null for every
other strategy, and the type widening matters even on SQLite — the adopted-
database test compares reflected types against a fresh install attribute by
attribute, so an old VARCHAR(3) would be drift.

Revision ID: 0021_elimination_rounds
Revises: 0020_slowest_race
Create Date: 2026-08-24

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0021_elimination_rounds"
down_revision: str | Sequence[str] | None = "0020_slowest_race"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the loss threshold and widen the strategy enum."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("elimination_losses", sa.Integer(), nullable=True)
        )
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.VARCHAR(length=3),
            type_=sa.Enum("PPC", "ELIMINATION", name="schedulingstrategy"),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Drop the threshold and narrow the enum back.

    An elimination round degrades to a PPC-shaped row its strategy no longer
    names; the old code never reads the value, so the narrowing is safe.
    """
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column(
            "scheduling_strategy",
            existing_type=sa.Enum("PPC", "ELIMINATION", name="schedulingstrategy"),
            type_=sa.VARCHAR(length=3),
            existing_nullable=False,
        )
        batch_op.drop_column("elimination_losses")
