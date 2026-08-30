"""Name-display columns, on ``organizations`` and ``races`` (#552).

How much of a racer's name a public screen may show — ``FULL`` (the
default), ``LAST_INITIAL`` ("Jordan M."), or ``FIRST_ONLY`` ("Jordan"). One
nullable ``varchar`` column per table, following ``0031_terminology`` and
``0033_vehicle_terminology`` exactly: null means "inherit the layer
beneath", all the way down to ``FULL``, which is what every install and
every race showed before this column existed. An upgraded install reads no
differently than it did before this migration.

No ``CHECK`` constraint and no server default — `domain/name_display.py`
resolves an unrecognised or absent value to ``"FULL"`` rather than the
database enforcing the vocabulary, the same relationship the vehicle
artwork key already has with its column. No data to carry either way, so
the downgrade is a plain drop.

Revision ID: 0040_name_display
Revises: 0039_excluded_from_standings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0040_name_display"
down_revision: str | Sequence[str] | None = "0039_excluded_from_standings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("organizations", "races"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("name_display", sa.String(), nullable=True))


def downgrade() -> None:
    for table in ("races", "organizations"):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column("name_display")
