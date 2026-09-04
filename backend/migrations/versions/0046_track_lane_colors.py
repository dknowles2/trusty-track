"""tracks.lane_colors (#611, stage 2)

Real pinewood derby tracks almost universally paint or sleeve each lane a
different colour, and the staging crew calls cars by it: "put car #12 in
the blue lane". This is the one column that carries an operator's chosen
colours — one hex string per physical lane, index 0 meaning lane 1, the
same indexing `domain.lane_colors.color_for_lane` reads.

A JSON array rather than a comma-separated string in a `String` column —
the shape issue #5 spent a release removing (see `LaneOutage`'s own
docstring for the same call made once already) — so this uses SQLAlchemy's
`JSON` type, which round-trips a plain Python list with no hand-rolled
(de)serialization.

The default empty list means no lane has a configured colour, which is
what every existing track had before this column existed: nothing here
changes what any screen renders until an operator sets one.

Revision ID: 0046_track_lane_colors
Revises: 0045_one_trophy_per_racer
Create Date: 2026-09-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0046_track_lane_colors"
down_revision: str | Sequence[str] | None = "0045_one_trophy_per_racer"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "lane_colors",
                sa.JSON(),
                server_default="[]",
                nullable=False,
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("tracks", schema=None) as batch_op:
        batch_op.drop_column("lane_colors")
