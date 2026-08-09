"""The audit log (#219).

`race_id` is deliberately a plain integer rather than a foreign key: deleting a
race must not take the record of what was done to it. See `models.AuditEntry`.

Revision ID: 0019_audit_log
Revises: 0018_weight_limit
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019_audit_log"
down_revision: str | Sequence[str] | None = "0018_weight_limit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "audit_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("at", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("source_ip", sa.String(), nullable=True),
        sa.Column("race_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("audit_entries", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_audit_entries_action"), ["action"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_audit_entries_at"), ["at"], unique=False)
        batch_op.create_index(batch_op.f("ix_audit_entries_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_audit_entries_race_id"), ["race_id"], unique=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("audit_entries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_audit_entries_race_id"))
        batch_op.drop_index(batch_op.f("ix_audit_entries_id"))
        batch_op.drop_index(batch_op.f("ix_audit_entries_at"))
        batch_op.drop_index(batch_op.f("ix_audit_entries_action"))

    op.drop_table("audit_entries")
