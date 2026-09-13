"""``rounds.runs_per_lane`` (#1088).

The round wizard's own "how many runs per lane" answer for each round, kept
only as a parameter to `crud.generate_heats_for_round` until now — nothing
persisted it on the row itself, so nothing could later ask a round "how many
runs was this?" without also knowing the field size the heat count had been
generated against. `domain.round_plan.plan_from_rounds` needs the answer
directly, to copy a previous race's round plan into a new one, so this
records it rather than trying to recover it from the heat count.

Nullable, and every round created before this migration reads back null —
there is nothing to backfill from, since the value was never stored. A copy
treats a null the same as `1`, the wizard's own default for a round with no
opinion, rather than refusing to copy a race scheduled before this column
existed.

Revision ID: 0052_round_runs_per_lane
Revises: 0051_race_theme_overrides
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0052_round_runs_per_lane"
down_revision: str | Sequence[str] | None = "0051_race_theme_overrides"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.add_column(sa.Column("runs_per_lane", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.drop_column("runs_per_lane")
