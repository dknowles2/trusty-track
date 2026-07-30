"""add heats.recorded_at

Issue #59. The timing stats display picks the heat that just ran, and had no way
to compare an official heat against a free one: ``created_at`` is when a free
heat was made (near enough when it ran) but when an official heat's *round* was
generated, long before anyone raced. So the resolver preferred official heats
whenever any had a time, which made exhibition runs unreachable from the first
result of the day onward.

``recorded_at`` is when a result was last saved, for both kinds. Null means no
result; ``crud.stamp_recorded`` keeps the two in step, including clearing it
when a heat is re-run.

No backfill. Existing rows hold null and fall back to schedule order behind
anything stamped, which is exactly what the old rule did — so a database
upgraded mid-event answers as it did before until the next result lands, and
every result after that is ordered properly.

Revision ID: 0007_recorded_at
Revises: 0006_fold_free_heats
Create Date: 2026-07-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_recorded_at"
down_revision: str | Sequence[str] | None = "0006_fold_free_heats"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.add_column(sa.Column("recorded_at", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("heats", schema=None) as batch_op:
        batch_op.drop_column("recorded_at")
