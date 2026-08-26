"""A speed award can name the slowest car rather than the fastest.

Plenty of packs give a trophy for the slowest car, and until now a speed award
could only count from the top of the standings. This column flips which end
``place`` counts from — the same flip `rounds.advancement_from_bottom` makes
for a Slowest Race bracket. Defaults false, so every existing award keeps
meaning what it meant.

Revision ID: 0024_slowest_car_awards
Revises: 0023_track_records
Create Date: 2026-08-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0024_slowest_car_awards"
down_revision: str | Sequence[str] | None = "0023_track_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the direction flag, false for every existing award."""
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "from_bottom",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Drop the flag. A slowest-car award degrades to a fastest-car one."""
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.drop_column("from_bottom")
