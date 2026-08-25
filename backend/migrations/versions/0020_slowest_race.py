"""Rounds can draw their field from the bottom of the standings.

A "Slowest Race" bracket is a championship round whose slots are filled from
the wrong end of the leaderboard. The source vocabulary is unchanged; this
column only flips which end the field comes from. Defaults false, so every
existing round keeps meaning what it meant.

Revision ID: 0020_slowest_race
Revises: 0019_audit_log
Create Date: 2026-08-24

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020_slowest_race"
down_revision: str | Sequence[str] | None = "0019_audit_log"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the direction flag, false for every existing round."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "advancement_from_bottom",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Drop the flag. A slowest-race round degrades to an ordinary one."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.drop_column("advancement_from_bottom")
