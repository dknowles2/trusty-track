"""``races.master_running_order`` (#549, stage 2).

One interleaved running order across a race's racing groups, rather than a
block per group. Off by default — the column defaults to false, which is
what every existing race already does: run one den's round, then the next.

A `server_default` is needed, the same reasoning as `0017_round_disrupted`
and `0032_race_tiebreaker`: this lands on a table that already has rows, and
a plain ``NOT NULL`` add-column with no default fails against every existing
install.

Re-parented onto `0033_vehicle_terminology` (#551) rather than
`0032_race_tiebreaker`: both landed as siblings off the same parent, and this
one merged second.

Revision ID: 0034_master_running_order
Revises: 0033_vehicle_terminology
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0034_master_running_order"
down_revision: str | Sequence[str] | None = "0033_vehicle_terminology"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "master_running_order",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("master_running_order")
