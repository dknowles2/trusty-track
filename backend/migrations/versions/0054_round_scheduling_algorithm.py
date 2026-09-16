"""``rounds.scheduling_algorithm`` (#1090, part B: "the seam").

`domain/scheduling.py`'s `generate_ppc` used to be the only way a `GENERAL`
round's schedule was built. This adds a `Round` column naming which
algorithm built (or should rebuild) the round's own schedule — `PPC` or
`ROTATION` (`domain/schedulers/rotation.py`), with `PERFECT_N` left for a
later PR per the epic's decision to land one algorithm behind the seam
first, not a placeholder with nothing behind it yet.

Nullable, and every round created before this migration — and every round
created after it that does not ask for anything else — reads back null.
Null means `PPC` rather than being backfilled to the literal string, so the
one place that resolves the default is `crud.round_algorithm`
(`api.schema`'s `Round.algorithm` GraphQL field restates the same rule, since
a Strawberry field resolver's `self` is the ORM row rather than something
that can call back into `crud`) — not a server default here, which would
duplicate the rule into the schema for a column half the rows never read
(`ELIMINATION`/`BALANCED` rounds build their own schedules and ignore it).

Revision ID: 0054_round_scheduling_algorithm
Revises: 0053_general_round_format
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0054_round_scheduling_algorithm"
down_revision: str | Sequence[str] | None = "0053_general_round_format"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ALGORITHM_ENUM = sa.Enum("PPC", "ROTATION", name="schedulingalgorithm")


def upgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("scheduling_algorithm", _ALGORITHM_ENUM, nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.drop_column("scheduling_algorithm")
