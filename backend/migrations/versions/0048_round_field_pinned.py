"""rounds.field_pinned (#711)

A championship round whose line-up was chosen by hand. The recorded-result
cascade recomputes every unraced championship field on every result; this
flag is what tells it to leave one alone. False for every round that existed
before the column did — nothing an operator has not explicitly pinned
changes behaviour.

Revision ID: 0048_round_field_pinned
Revises: 0047_race_qr_display
Create Date: 2026-09-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0048_round_field_pinned"
down_revision: str | Sequence[str] | None = "0047_race_qr_display"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "field_pinned",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.drop_column("field_pinned")
