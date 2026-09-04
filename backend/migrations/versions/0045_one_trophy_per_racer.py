"""races.one_trophy_per_racer (#615)

The near-universal pack rule: a racer who already holds a trophy is skipped
when resolving a later one, so a den speed trophy "rolls down" to the next
fastest car once its own winner has already taken the pack championship. See
`domain/roll_down.py` for the whole rule — nothing else is stored, since a
roll-down is a way of reading the standings, computed fresh on every read,
the same as every other award in this table's neighbourhood.

`NOT NULL` with a `false` server default, so every race that existed before
this column did keeps resolving every award in isolation exactly as it
always has — the same shape `master_running_order` and `voting_open` use.

Revision ID: 0045_one_trophy_per_racer
Revises: 0044_intermission
Create Date: 2026-09-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0045_one_trophy_per_racer"
down_revision: str | Sequence[str] | None = "0044_intermission"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "one_trophy_per_racer",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("one_trophy_per_racer")
