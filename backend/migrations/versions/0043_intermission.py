"""races.intermission_ends_at, races.intermission_label,
races.intermission_paused_remaining_seconds (#592)

A race-scoped break, on the fly or from the round-summary modal's "Take a
break" row. Stored, not in-memory like a `Display` `Assignment` (#174) — an
intermission describes the *race*, and every screen watching it, including
the operator's own laptop, has to agree after a refresh. See
`domain/intermission.py` for the full rule these three columns implement.

All three are nullable with no server default, and every existing race gets
all three null — exactly "no intermission", the state every race was already
in before this column existed.

Revision ID: 0043_intermission
Revises: 0042_track_scale_speed
Create Date: 2026-09-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0043_intermission"
down_revision: str | Sequence[str] | None = "0042_track_scale_speed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("intermission_ends_at", sa.String(), nullable=True)
        )
        batch_op.add_column(sa.Column("intermission_label", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "intermission_paused_remaining_seconds", sa.Integer(), nullable=True
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("intermission_paused_remaining_seconds")
        batch_op.drop_column("intermission_label")
        batch_op.drop_column("intermission_ends_at")
