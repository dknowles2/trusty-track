"""races.is_locked (#585)

Once an event has concluded, an operator can lock its race to guard against
an accidental edit on a shared machine — a stray tap on a tablet weeks
later, not a person with something to hide. Off by default (``server_default
false()``), so every race that existed before this column did reads exactly
as it did before. Enforced in ``api/race_lock.py``, a third schema extension
alongside the role policy and the demo policy; this column is otherwise a
plain boolean like ``voting_open`` or ``master_running_order``.

Revision ID: 0043_race_is_locked
Revises: 0042_track_scale_speed
Create Date: 2026-09-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0043_race_is_locked"
down_revision: str | Sequence[str] | None = "0042_track_scale_speed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_locked",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("is_locked")
