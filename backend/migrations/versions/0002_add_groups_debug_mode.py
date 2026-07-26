"""add groups.debug_mode

This column predates Alembic. Before migrations existed, ``init_db()`` tried to
add it with a hand-rolled ``ALTER TABLE`` wrapped in a bare ``except: pass``, so
a database in the wild may or may not already have it depending on whether that
statement happened to succeed.

The upgrade therefore inspects the table first and only adds the column when it
is genuinely missing. That makes this revision safe to run against:

  * a fresh database (0001 created ``groups`` without the column)
  * a legacy database where the old ALTER succeeded (column present, skip)
  * a legacy database where the old ALTER silently failed (column added)

Revision ID: 0002_debug_mode
Revises: 0001_baseline
Create Date: 2026-07-24

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_debug_mode"
down_revision: str | Sequence[str] | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_debug_mode() -> bool:
    inspector = sa.inspect(op.get_bind())
    return "debug_mode" in {col["name"] for col in inspector.get_columns("groups")}


def upgrade() -> None:
    """Add groups.debug_mode unless a legacy database already has it."""
    if _has_debug_mode():
        return
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "debug_mode",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    """Remove groups.debug_mode."""
    if not _has_debug_mode():
        return
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.drop_column("debug_mode")
