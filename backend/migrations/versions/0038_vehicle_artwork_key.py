"""Vehicle artwork key columns, on ``organizations`` and ``races`` (#551,
stage 4).

The vehicle word (``0033_vehicle_terminology``) got the word right; this adds
which picture goes with it — a car by default, a rocket for a Space Derby, a
boat for a Raingutter Regatta. A plain string, not an enum, matching
``Award.artwork_key``: the frontend's ``PrintDecor.tsx`` holds the one
canonical vocabulary (``domain.terminology.VEHICLE_ARTWORK_KEYS``), and
nothing server-side branches on which key this is.

Purely additive, following ``0033_vehicle_terminology`` exactly: one more
nullable ``varchar`` column per table. Every existing row gets null in both,
which `domain/terminology.py` resolves to ``"car"`` — an upgraded install
prints exactly what it always has.

No ``CHECK`` constraint, no server default, and no data to carry either way.
The downgrade is a plain drop.

Revision ID: 0038_vehicle_artwork_key
Revises: 0037_track_reverse_lanes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0038_vehicle_artwork_key"
down_revision: str | Sequence[str] | None = "0037_track_reverse_lanes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMN = "vehicle_artwork_key"


def upgrade() -> None:
    for table in ("organizations", "races"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column(_COLUMN, sa.String(), nullable=True))


def downgrade() -> None:
    for table in ("races", "organizations"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column(_COLUMN)
