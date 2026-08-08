"""tracks.timer_profile — the timer model an operator picked

Issue #143. ``timer_type`` says how the timer is reached; this says what it is.
Null keeps the behaviour every existing track has: probe for it.

Nothing to backfill. A null column means "work it out", which is exactly what
every track was doing before this existed.

Revision ID: 0011_track_timer_profile
Revises: 0010_heat_lanes_on_delete
Create Date: 2026-08-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_track_timer_profile"
down_revision: str | Sequence[str] | None = "0010_heat_lanes_on_delete"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("timer_profile", sa.String(), nullable=True))


def downgrade() -> None:
    """Back to detecting the model.

    A track that named one loses that setting and goes back to probing, which
    is the behaviour it had before this column — so nothing is stranded, though
    a NewBold picked here becomes unreachable again.
    """
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.drop_column("timer_profile")
