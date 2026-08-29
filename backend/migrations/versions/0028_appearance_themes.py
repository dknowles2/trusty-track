"""Display and Printables theme settings on ``Group`` (#498, stage 2).

Two ``varchar`` columns, ``NOT NULL`` with a server default of
``'MATCH_APP'`` — a fresh row and every row already in the table get the
same value. That default is itself the "off" state (see ``InitialConfigInput``
in ``api/schema.py``), which is what makes this unlike ``weight_limit_oz`` or
the operator PIN: there is no bare-null "leave alone versus clear" ambiguity
for either of these to resolve, so no companion clear flag is needed.

The App theme (`localStorage`, per device) is not stored here at all — it
never reaches the server. Only Display and Printables are install-wide.

Revision ID: 0028_appearance_themes
Revises: 0027_no_timer_type
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0028_appearance_themes"
down_revision: str | Sequence[str] | None = "0027_no_timer_type"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add ``groups.display_theme`` and ``groups.printables_theme``."""
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "display_theme",
                sa.String(),
                nullable=False,
                server_default=sa.text("'MATCH_APP'"),
            )
        )
        batch_op.add_column(
            sa.Column(
                "printables_theme",
                sa.String(),
                nullable=False,
                server_default=sa.text("'MATCH_APP'"),
            )
        )


def downgrade() -> None:
    """Drop them."""
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.drop_column("printables_theme")
        batch_op.drop_column("display_theme")
