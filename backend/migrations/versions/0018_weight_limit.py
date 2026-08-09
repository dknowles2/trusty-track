"""Add the pack's weight limit to a race (#205).

Nullable, and deliberately with no server default: null means the race does
not check weights, which is what every race created before this did. Giving
existing rows a limit would suddenly flag cars a person had already passed at
the inspection table.

Revision ID: 0018_weight_limit
Revises: 0017_round_disrupted
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018_weight_limit"
down_revision: str | Sequence[str] | None = "0017_round_disrupted"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(sa.Column("weight_limit_oz", sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("weight_limit_oz")
