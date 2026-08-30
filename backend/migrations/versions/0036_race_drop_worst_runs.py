"""``races.drop_worst_runs`` (#547, stage 2).

How many of each racer's worst counted results to drop before scoring — a
modifier over `scoring_strategy`, not a strategy of its own. `0`, the
default, is the off state: every existing race scores exactly as it did
before this column existed.

A `server_default` is needed for the same reason `0034_master_running_order`
and `0032_race_tiebreaker` needed one: this lands on a table that already
has rows, and a plain `NOT NULL` add-column with no default fails against
every existing install.

Revision ID: 0036_race_drop_worst_runs
Revises: 0035_scoring_strategy_cumulative_fastest
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0036_race_drop_worst_runs"
down_revision: str | Sequence[str] | None = "0035_scoring_strategy_cumulative_fastest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "drop_worst_runs",
                sa.Integer(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("drop_worst_runs")
