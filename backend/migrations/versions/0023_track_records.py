"""Historical track records.

A table for records set before Trusty Track was keeping them. The computed
records never store anything — a corrected time must move them — but a
record from the 2019 derby has no heats in this database to compute from,
so it is primary data the operator types in, standing exactly as written.

``racer_name`` is free text rather than a racer foreign key: the child who
set the record is not on any roster this install holds. The foreign key to
``tracks`` cascades — a record of a track that no longer exists has nowhere
to be shown.

Revision ID: 0023_track_records
Revises: 0022_balanced_rounds
Create Date: 2026-08-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0023_track_records"
down_revision: str | Sequence[str] | None = "0022_balanced_rounds"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the track_records table."""
    op.create_table(
        "track_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=False),
        sa.Column("time_seconds", sa.Float(), nullable=False),
        sa.Column("racer_name", sa.String(), nullable=False),
        sa.Column("car_number", sa.Integer(), nullable=True),
        sa.Column("race_name", sa.String(), nullable=True),
        sa.Column("race_date", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("track_records", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_track_records_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_track_records_track_id"), ["track_id"], unique=False
        )


def downgrade() -> None:
    """Drop the table, and the hand-entered records with it."""
    with op.batch_alter_table("track_records", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_track_records_track_id"))
        batch_op.drop_index(batch_op.f("ix_track_records_id"))
    op.drop_table("track_records")
