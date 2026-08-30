"""``races.tiebreaker`` (#540, stage 1).

How a shared score is broken at a cut — advancement, an award's place — once
the standings can no longer just display the tie and move on. `SHARED` (not
resolved; a cut still reports the tie and takes a provisional pick) is the
default and the only value that changes nothing: every existing race gets it,
which is what makes this stage a pure no-op behaviourally. The other four
values (`BEST_TIME`, `TOTAL_TIME`, `COUNTBACK`, `HEAD_TO_HEAD`) are wired up
starting in stage 2 — this migration only makes the column exist.

A `server_default` is needed, unlike `scoring_strategy`'s own column, because
this one is landing on a table that already has rows: a plain ``NOT NULL``
add-column with no default would fail against every existing install.

Revision ID: 0032_race_tiebreaker
Revises: 0031_terminology
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0032_race_tiebreaker"
down_revision: str | Sequence[str] | None = "0031_terminology"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "tiebreaker",
                sa.Enum(
                    "SHARED",
                    "BEST_TIME",
                    "TOTAL_TIME",
                    "COUNTBACK",
                    "HEAD_TO_HEAD",
                    name="tiebreakmethod",
                ),
                nullable=False,
                server_default=sa.text("'SHARED'"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("tiebreaker")
