"""tracks.scale_ratio, tracks.show_scale_speed (#610, stage 2)

Storage for the scale-speed conversion stage 1 added the pure arithmetic
for (`domain/scale_speed.py`). ``scale_ratio`` is the vehicle-to-real-life
ratio a track's cars are built to — a ~7-inch BSA Pinewood Derby car against
a ~175-inch real car is 1:25, ``domain.scale_speed.DEFAULT_SCALE``, and
every existing track gets that value rather than leaving the column blank:
a scale of zero is indistinguishable from "not configured" only by reading
this migration, where 25 is what the ratio already was implicitly for every
race this app has run.

``show_scale_speed`` is a plain flag, not "length_feet > 0" folded in — a
track's length can be filled in later, and an operator running a format the
ratio does not apply to needs a way to turn the whole idea off once. Every
reader that decides whether to display scale speed (stage 4) ANDs this with
a positive ``length_feet``; this column alone does not promise a length
exists to compute from. Existing tracks default to on, matching "default on
if length > 0" from the issue for the common case where a length is already
recorded, and costing nothing worse than an unreachable feature for the rest
(no length means `scale_mph` already returns ``None``).

Revision ID: 0042_track_scale_speed
Revises: 0041_run_off_heats
Create Date: 2026-09-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0042_track_scale_speed"
down_revision: str | Sequence[str] | None = "0041_run_off_heats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "scale_ratio",
                sa.Float(),
                server_default=sa.text("25"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "show_scale_speed",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.drop_column("show_scale_speed")
        batch_op.drop_column("scale_ratio")
