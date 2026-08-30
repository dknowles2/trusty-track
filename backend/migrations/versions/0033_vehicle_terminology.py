"""Vehicle terminology columns, on ``organizations`` and ``races`` (#551,
stage 1).

The third configurable term #496 stage 3 left for later: what a racer's
vehicle is called. "Car" is wrong for a Space Derby (rockets) or a
Raingutter Regatta (boats), and both are run by the same volunteer with the
same roster and the same standings as a pinewood derby.

Purely additive, following ``0031_terminology`` exactly: four more nullable
``varchar`` columns, two per table, singular and plural. Every existing row
gets null in all four, which `domain/terminology.py` resolves to "Car"/"Cars"
— an upgraded install reads no differently than it did before this landed.

No ``CHECK`` constraint, no server default, and no data to carry either way.
The downgrade is a plain drop.

Revision ID: 0033_vehicle_terminology
Revises: 0032_race_tiebreaker
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0033_vehicle_terminology"
down_revision: str | Sequence[str] | None = "0032_race_tiebreaker"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    "vehicle_singular",
    "vehicle_plural",
)


def upgrade() -> None:
    for table in ("organizations", "races"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            for column in _COLUMNS:
                batch_op.add_column(sa.Column(column, sa.String(), nullable=True))


def downgrade() -> None:
    for table in ("races", "organizations"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            for column in reversed(_COLUMNS):
                batch_op.drop_column(column)
