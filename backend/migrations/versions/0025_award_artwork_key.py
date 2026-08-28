"""Ready-made superlative awards get artwork for the ceremony and a certificate.

`awards.artwork_key` names which clipart to draw — see `frontend/src/features/
awards/artwork.tsx` for the pictures and `backend/domain/awards.py` for how a
`SPEED` award's key is worked out from its rule. Nullable, and every existing
award gets null: a plain certificate, until the operator picks a ready-made
superlative or the award is a `SPEED` one, whose key `crud._set_speed_artwork_key`
fills in the next time it is saved.

Revision ID: 0025_award_artwork_key
Revises: 0024_slowest_car_awards
Create Date: 2026-08-27

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0025_award_artwork_key"
down_revision: str | Sequence[str] | None = "0024_slowest_car_awards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the column, null on every existing award."""
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("artwork_key", sa.String(), nullable=True))


def downgrade() -> None:
    """Drop it. An award reverts to no artwork at all, same as before this."""
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.drop_column("artwork_key")
