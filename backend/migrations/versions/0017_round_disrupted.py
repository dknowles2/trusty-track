"""A round disrupted by a lane going out of service (#171).

One column, defaulting to false, which is what every existing round was: no
lane had gone out of service part-way through it.

The server default matters and is not decoration — `groups.debug_mode` needed
three migrations because a Python-side default hides a missing one (#32), so
this carries both.

Revision ID: 0017_round_disrupted
Revises: 0016_lane_outages
Create Date: 2026-08-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0017_round_disrupted"
down_revision: str | Sequence[str] | None = "0016_lane_outages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "disrupted", sa.Boolean(), server_default=sa.text("0"), nullable=False
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.drop_column("disrupted")
