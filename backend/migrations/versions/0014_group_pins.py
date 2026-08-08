"""add groups.operator_pin_hash and groups.checkin_pin_hash

Issue #15. Storage for the operator and check-in PINs, as `salt$hash`.

Both nullable, and an unset *operator* PIN means no enforcement — every caller
is treated as the operator, which is what every install does today. That is
what lets this land without breaking an upgrade mid-season, and it is why the
column has no default: "not set" is a real state with a defined meaning, not a
placeholder.

Revision ID: 0014_group_pins
Revises: 0013_drop_lane_results
Create Date: 2026-08-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014_group_pins"
down_revision: str | Sequence[str] | None = "0013_drop_lane_results"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.add_column(sa.Column("operator_pin_hash", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("checkin_pin_hash", sa.String(), nullable=True))


def downgrade() -> None:
    """Drop both PINs, which turns enforcement off — the state a database
    upgraded from before #15 is already in."""
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.drop_column("checkin_pin_hash")
        batch_op.drop_column("operator_pin_hash")
