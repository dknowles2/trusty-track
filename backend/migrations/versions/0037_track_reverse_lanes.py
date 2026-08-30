"""tracks.reverse_lanes (#553, part 1)

A finish-line unit is wired to lanes 1..N in whatever order the installer
happened to plug it in. When that order runs opposite to the way the track
is numbered on the wall, every result lands on the wrong car, and the only
fix available today is to rewire the timer or renumber the track.

Same shape as ``0009_track_remote_start``, and for the same reason: whether
the cable runs backwards is a fact about this venue, not about the timer
model, so it lives on ``Track`` rather than on ``TimerProfile``.

Off by default, and for existing tracks. A wrong ``False`` costs a track
that keeps mis-recording exactly as it did before this setting existed; a
wrong ``True`` costs a track that had it right and now does not.

Revision ID: 0037_track_reverse_lanes
Revises: 0036_race_drop_worst_runs
Create Date: 2026-08-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0037_track_reverse_lanes"
down_revision: str | Sequence[str] | None = "0036_race_drop_worst_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "reverse_lanes",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.drop_column("reverse_lanes")
