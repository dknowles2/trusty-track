"""Custom terminology columns, on ``organizations`` and ``races`` (#496,
stage 3).

Purely additive: eight nullable ``varchar`` columns, four per table, for the
two configurable terms this stage introduces — a racing group's name (``Den``
by default) and the organization's own name (``Pack`` by default), each as a
singular and a plural. Every existing row gets null in all eight, which
`domain/terminology.py` resolves to exactly the words every screen already
shows — an upgraded install reads no differently than it did before this
landed.

No ``CHECK`` constraint, no server default, and no data to carry either way:
unlike stage 1's advancement-source swap or stage 2's rank-to-division
rewrite, nothing here reinterprets a value that already exists. The
downgrade is a plain drop.

Revision ID: 0031_terminology
Revises: 0030_racing_group_division
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0031_terminology"
down_revision: str | Sequence[str] | None = "0030_racing_group_division"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLUMNS = (
    "racing_group_singular",
    "racing_group_plural",
    "organization_singular",
    "organization_plural",
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
