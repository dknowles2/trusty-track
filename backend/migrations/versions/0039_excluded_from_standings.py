"""A car can race and not be ranked (#548).

Two additions, both booleans and both off by default so an upgraded install
reads exactly as it did before this migration:

* ``racers.excluded_from_standings`` — a sibling, parent or outlaw-class car
  that goes down the track like everyone else but should never take a
  trophy. Read in exactly one place, ``services/scoring.get_leaderboard``.
* ``races.exclude_round_winners_from_qualifying_standings`` — once a
  championship round is decided, its winner(s) stop counting toward the
  standings of the round they qualified from, so a Grand Finals pack
  champion does not also keep their own den's trophy.

Both need a ``server_default`` for the same reason ``0036_race_drop_worst_runs``
did: they land on tables that already have rows.

Revision ID: 0039_excluded_from_standings
Revises: 0038_vehicle_artwork_key
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039_excluded_from_standings"
down_revision: str | Sequence[str] | None = "0038_vehicle_artwork_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "excluded_from_standings",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )

    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "exclude_round_winners_from_qualifying_standings",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.drop_column("exclude_round_winners_from_qualifying_standings")

    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.drop_column("excluded_from_standings")
