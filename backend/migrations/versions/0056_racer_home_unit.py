"""``racers.home_unit`` (#1076, stage 1).

A racer's own unit — "Pack 12" — distinct from `racing_group_id` (the rank
they race within, which at a district event is shared with racers from a
dozen different units). Free text, nullable: no existing racer gets a value,
so an ordinary single-pack race is untouched — every surface that renders
this field is conditional on it being non-empty, and nothing here has one.

The downgrade drops the column outright. Any value an operator has typed by
the time somebody rolls back is lost, the same trade every other purely
additive, nullable text column in this history takes (`car_name`, the
terminology overrides) — there is nowhere else for the value to go once the
column is gone, and refusing the downgrade over a value nothing else in the
schema depends on would be worse than losing it.

Revision ID: 0056_racer_home_unit
Revises: 0055_perfect_n_algorithm
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0056_racer_home_unit"
down_revision: str | Sequence[str] | None = "0055_perfect_n_algorithm"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable column. Nothing to backfill."""
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("home_unit", sa.String(), nullable=True))


def downgrade() -> None:
    """Drop the column. Any value typed is lost with it."""
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.drop_column("home_unit")
