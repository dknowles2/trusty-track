"""Awards: the trophies a race hands out (#170).

A new table, no data migration. Every existing race gets no awards, which is
what it had before.

``race_id`` and ``den_id`` cascade; ``racer_id`` sets null. Deleting a racer
should un-assign a special award, not delete the trophy — an award with no
recipient is an ordinary state, since most have none until the end of an event.

Revision ID: 0015_awards
Revises: 0014_group_pins
Create Date: 2026-08-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015_awards"
down_revision: str | Sequence[str] | None = "0014_group_pins"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "awards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("race_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "kind", sa.Enum("SPEED", "SPECIAL", name="awardkind"), nullable=False
        ),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("place", sa.Integer(), nullable=True),
        sa.Column("den_id", sa.Integer(), nullable=True),
        sa.Column("racer_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["den_id"], ["dens.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["race_id"], ["races.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["racer_id"], ["racers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_awards_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_awards_race_id"), ["race_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_awards_race_id"))
        batch_op.drop_index(batch_op.f("ix_awards_id"))

    op.drop_table("awards")
