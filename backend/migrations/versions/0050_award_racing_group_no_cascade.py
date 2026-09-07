"""Stop cascading an award away when its den is deleted (#755)

``awards.racing_group_id`` carried ``ondelete="CASCADE"`` since the table was
created (0015). That is wrong the same way a cascade on ``rounds
.racing_group_id`` would be wrong, and that column has never had one:
deleting a den that a ``SPEED`` award is narrowed to — "Fastest Wolf" — used to
silently destroy the award (and, via ``award_votes``' own cascade off
``awards``, any ballots already cast for it), with nothing on screen saying
so beyond the racer-unassignment warning the delete confirmation already
carries.

``crud.delete_racing_group`` now refuses instead, naming the awards, mirroring
the round-scoped check that already sits above it in that function — nulling
the column would be just as wrong as nulling a round's ``racing_group_id``:
"Fastest Wolf" would silently become "Fastest overall", a different trophy
that may go to a different child. This migration drops the ``CASCADE`` action
so the schema backs that refusal rather than contradicting it (#125,
"deletion is the schema's job, not Python's") — a future caller that bypasses
the Python check hits an ``IntegrityError`` rather than losing the row
silently.

SQLite cannot alter a foreign key's ``ON DELETE`` action in place, and the
original three foreign keys on this table were created inline in
``op.create_table`` (0015), so they are unnamed and cannot be dropped by
name (the same trap 0010's docstring describes for ``heat_lanes``). The table
is rebuilt via ``batch_alter_table``'s ``copy_from``, which is what actually
drops them; ``race_id`` and ``racer_id`` are recreated with the actions they
already had, and only ``racing_group_id`` changes.

Revision ID: 0050_award_racing_group_no_cascade
Revises: 0049_display_scenes
Create Date: 2026-09-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0050_award_racing_group_no_cascade"
down_revision: str | Sequence[str] | None = "0049_display_scenes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The table as it stands at 0049, minus its foreign keys — handed to
#: ``batch_alter_table`` as ``copy_from`` so the rebuild works from this
#: rather than from reflection. Omitting the constraints is what drops them.
#: The indexes have to be listed even though they are not changing; anything
#: absent from this definition is absent from the rebuilt table.
AWARDS = sa.Table(
    "awards",
    sa.MetaData(),
    sa.Column("id", sa.Integer(), nullable=False),
    sa.Column("race_id", sa.Integer(), nullable=False),
    sa.Column("name", sa.String(), nullable=False),
    sa.Column("kind", sa.String(length=7), nullable=False),
    sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
    sa.Column("source", sa.String(), nullable=True),
    sa.Column("place", sa.Integer(), nullable=True),
    sa.Column("racing_group_id", sa.Integer(), nullable=True),
    sa.Column("racer_id", sa.Integer(), nullable=True),
    sa.Column("from_bottom", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    sa.Column("artwork_key", sa.String(), nullable=True),
    sa.Column("votable", sa.Boolean(), server_default=sa.text("0"), nullable=False),
    sa.PrimaryKeyConstraint("id"),
    sa.Index("ix_awards_id", "id"),
    sa.Index("ix_awards_race_id", "race_id"),
)


def upgrade() -> None:
    with op.batch_alter_table("awards", copy_from=AWARDS, schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_awards_race_id", "races", ["race_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_foreign_key(
            "fk_awards_racer_id",
            "racers",
            ["racer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_awards_racing_group_id",
            "racing_groups",
            ["racing_group_id"],
            ["id"],
        )


def downgrade() -> None:
    """Back to ``racing_group_id`` cascading.

    This is what #755 removes; downgrading restores the original, dangerous
    behaviour exactly, which is what makes down-and-back-up lossless — there
    is no data to repair, only the constraint to put back.
    """
    with op.batch_alter_table("awards", copy_from=AWARDS, schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_awards_race_id", "races", ["race_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_foreign_key(
            "fk_awards_racer_id",
            "racers",
            ["racer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_awards_racing_group_id",
            "racing_groups",
            ["racing_group_id"],
            ["id"],
            ondelete="CASCADE",
        )
