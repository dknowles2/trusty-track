"""Vote for the judged awards from a phone in the room (#305).

Three additions:

* ``races.voting_open`` — an operator toggle. False for every existing race,
  so an upgraded install does not suddenly start accepting ballots.
* ``awards.votable`` — per-award, `SPECIAL` only. False for every existing
  award, for the same reason; new judged awards are offered on by
  `AwardInput`'s GraphQL-level default rather than this column's, the same
  "form offers a sensible default, the column stays conservative" shape the
  weight limit uses (#205).
* ``award_votes`` — the ballots themselves. Both foreign keys cascade: a vote
  for a trophy or a car that no longer exists names nothing worth keeping.
  ``uq_award_ballot`` makes one ballot idempotent against a doubled click, not
  a lock on how many times a device may vote.

Revision ID: 0026_award_voting
Revises: 0025_award_artwork_key
Create Date: 2026-08-28

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0026_award_voting"
down_revision: str | Sequence[str] | None = "0025_award_artwork_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "award_votes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("award_id", sa.Integer(), nullable=False),
        sa.Column("racer_id", sa.Integer(), nullable=False),
        sa.Column("ballot_key", sa.String(), nullable=False),
        sa.Column("cast_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["award_id"], ["awards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["racer_id"], ["racers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("award_id", "ballot_key", name="uq_award_ballot"),
    )
    with op.batch_alter_table("award_votes", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_award_votes_award_id"), ["award_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_award_votes_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_award_votes_racer_id"), ["racer_id"], unique=False
        )

    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "votable",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )

    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "voting_open",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("voting_open")

    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.drop_column("votable")

    with op.batch_alter_table("award_votes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_award_votes_racer_id"))
        batch_op.drop_index(batch_op.f("ix_award_votes_id"))
        batch_op.drop_index(batch_op.f("ix_award_votes_award_id"))

    op.drop_table("award_votes")
