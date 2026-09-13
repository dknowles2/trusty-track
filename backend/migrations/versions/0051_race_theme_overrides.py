"""Per-race Display/Printables theme overrides, on ``races`` (#1081).

A race's own ``display_theme``/``printables_theme``, layered above
``organizations.display_theme``/``printables_theme`` (``0028_appearance_themes``)
the same way ``0031_terminology`` and ``0040_name_display`` layer a race
override above an organization default. Null means "inherit the install's
setting" — see ``domain/theme.py``'s ``resolve_theme_setting``. Unlike those
two migrations this is one table only: the organization layer already
exists and needs no new column, only a race-level one above it.

No ``CHECK`` constraint and no server default, the same relationship
``0040_name_display`` has with ``domain/name_display.py`` — an unrecognised
or absent value simply resolves as "inherit" rather than the database
enforcing the vocabulary. No data to carry either way, so the downgrade is
a plain drop; every race reads exactly as it did before this migration,
since a null override was always the only value that could exist.

Revision ID: 0051_race_theme_overrides
Revises: 0050_award_racing_group_no_cascade
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0051_race_theme_overrides"
down_revision: str | Sequence[str] | None = "0050_award_racing_group_no_cascade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(sa.Column("display_theme", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("printables_theme", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("printables_theme")
        batch_op.drop_column("display_theme")
