"""tracks.remote_start_installed

Some timers can drive a solenoid on the start gate, so the operator can launch
a heat from the screen instead of standing at the track. Whether a *track* has
that solenoid is not something any protocol reports — the MicroWizard's gate
release is a separately-sold accessory, and its `LG` command is silently
ignored without it — so it is a setting rather than something detected.

Off by default, and for existing tracks. A wrong ``False`` costs a button that
is not offered; a wrong ``True`` costs a gate that opens with nobody expecting
it.

Revision ID: 0009_track_remote_start
Revises: 0008_drop_racing_groups
Create Date: 2026-08-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009_track_remote_start"
down_revision: str | Sequence[str] | None = "0008_drop_racing_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "remote_start_installed",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.drop_column("remote_start_installed")
