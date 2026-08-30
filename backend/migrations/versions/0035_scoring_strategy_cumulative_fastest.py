"""``races.scoring_strategy`` gains ``CUMULATIVE_TIME`` and ``FASTEST_TIME``
(#547, stage 1).

Unlike `0027_no_timer_type`, this one is not a no-op. `ScoringStrategy` is
`SAEnum(ScoringStrategy)` with no `create_constraint`, so SQLite carries no
CHECK constraint on the column and a new member is not rejected by the
running database either way — but SQLAlchemy's generic `Enum` also declares
the column as a `VARCHAR` sized to the *longest* member at the time the table
was built, and `CUMULATIVE_TIME` (16 characters) is longer than `POINTS` (6,
the previous longest), so `alembic revision --autogenerate` against a
database at `0034` detects a real type change. The widening matters for the
same reason `0021` and `0022`'s did: `test_an_adopted_database_ends_up_with_
the_same_schema` compares reflected column types attribute by attribute
against a fresh install, and a `VARCHAR(6)` left over from before this
migration would disagree with what a fresh install now creates.

Revision ID: 0035_scoring_strategy_cumulative_fastest
Revises: 0034_master_running_order
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0035_scoring_strategy_cumulative_fastest"
down_revision: str | Sequence[str] | None = "0034_master_running_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Widen the strategy enum to include the two new members."""
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.alter_column(
            "scoring_strategy",
            existing_type=sa.Enum("TIMED", "POINTS", name="scoringstrategy"),
            type_=sa.Enum(
                "TIMED",
                "POINTS",
                "CUMULATIVE_TIME",
                "FASTEST_TIME",
                name="scoringstrategy",
            ),
            existing_nullable=False,
        )


def downgrade() -> None:
    """Narrow the enum back.

    No install migrated forward and back inside this repo's own test suite
    ever has a row using either new value — see `test_every_downgrade_runs_
    and_lands_back_at_the_same_schema`, which walks a *fresh* database. A real
    operator's race using `CUMULATIVE_TIME` or `FASTEST_TIME` who then
    downgrades keeps the stored string (SQLite enforces no CHECK constraint
    here, same as every other `SAEnum` column in this tree), but a fresh
    install built at the prior revision would reject it — narrowing is
    therefore lossy in the same sense `0030`'s downgrade documents itself as,
    not silently.
    """
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.alter_column(
            "scoring_strategy",
            existing_type=sa.Enum(
                "TIMED",
                "POINTS",
                "CUMULATIVE_TIME",
                "FASTEST_TIME",
                name="scoringstrategy",
            ),
            type_=sa.Enum("TIMED", "POINTS", name="scoringstrategy"),
            existing_nullable=False,
        )
