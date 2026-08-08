"""Lane outages: a lane that is out of service (#171).

A new table, no data migration. Every existing track has no outages, which is
what it had before — every lane usable.

Presence of a row is the whole meaning; there is no flag saying a lane works,
because such a row could disagree with its own absence.

Revision ID: 0016_lane_outages
Revises: 0015_awards
Create Date: 2026-08-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016_lane_outages"
down_revision: str | Sequence[str] | None = "0015_awards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lane_outages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("lane", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("track_id", "lane", name="uq_lane_outage"),
    )
    with op.batch_alter_table("lane_outages", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_lane_outages_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_lane_outages_track_id"), ["track_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("lane_outages", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_lane_outages_track_id"))
        batch_op.drop_index(batch_op.f("ix_lane_outages_id"))

    op.drop_table("lane_outages")
