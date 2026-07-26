"""add heats.kind and created_at; make round_id nullable

Issue #6, step one. Prepares ``heats`` to hold free race heats as well, without
moving any rows yet — every existing heat is ``OFFICIAL``, so nothing that runs
today behaves differently.

Splitting it out means the ``kind`` filters the rest of the codebase now needs
can be reviewed and tested on their own, before there is any data that could
leak through a missing one.

``round_id`` becomes nullable because a free race heat belongs to no round.
``created_at`` is how free heats order (newest first); official heats order by
round and heat number and leave it null.

Revision ID: 0005_heat_kind
Revises: 0004_debug_mode_notnull
Create Date: 2026-07-25

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_heat_kind"
down_revision: str | Sequence[str] | None = "0004_debug_mode_notnull"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "kind",
                sa.Enum("OFFICIAL", "FREE", name="heatkind"),
                server_default="OFFICIAL",
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("created_at", sa.String(), nullable=True))
        batch_op.alter_column("round_id", existing_type=sa.INTEGER(), nullable=True)
        batch_op.create_index(batch_op.f("ix_heats_kind"), ["kind"], unique=False)


def downgrade() -> None:
    """Reverse the schema change.

    Lossless while no free heats exist. Once step two moves them in, a
    downgrade past this point has to move them back out first — which is that
    migration's job, and it runs before this one.
    """
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_heats_kind"))
        batch_op.alter_column("round_id", existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_column("created_at")
        batch_op.drop_column("kind")
