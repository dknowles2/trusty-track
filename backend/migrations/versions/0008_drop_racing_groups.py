"""drop racing_groups and racers.racing_group_id

`RacingGroup` was a shadow of `Den`. Saving a racer into a den looked for a
racing group with that den's id, created one named ``"<Den>s"`` if there was
none, and stamped its id on the racer. Nothing ever read it back: no query
filtered on it, scheduling and scoring group by `den_id`, and it was never
exposed through GraphQL. The design note that kept it — "retained as a
secondary grouping concept for round-level scheduling" — described an intent
that was never built.

The cost was not only clutter. Creating a racer with a den issued a SELECT and,
for the first racer in each den, an INSERT plus its own `commit()` and
`refresh()` inside a function that then committed again; `bulk_move_to_den` did
the same again per call. Importing a roster paid for all of it.

The table is dropped rather than left in place because a written-but-never-read
table is worse than either: it looks like state something depends on.

Downgrade recreates the table and the column but not the rows. They were
derived from `racers.den_id` and can be derived again if anything ever needs
them.

Revision ID: 0008_drop_racing_groups
Revises: 0007_recorded_at
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_drop_racing_groups"
down_revision: str | Sequence[str] | None = "0007_recorded_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The column first: it holds the foreign key into the table being dropped,
    # and on SQLite the batch operation rebuilds `racers` without either.
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.drop_column("racing_group_id")

    op.drop_index("ix_racing_groups_id", table_name="racing_groups")
    op.drop_table("racing_groups")


def downgrade() -> None:
    op.create_table(
        "racing_groups",
        sa.Column("id", sa.INTEGER(), nullable=False),
        sa.Column("race_id", sa.INTEGER(), nullable=False),
        sa.Column("name", sa.VARCHAR(), nullable=False),
        sa.Column("den_id", sa.INTEGER(), nullable=True),
        sa.Column("car_number_range_start", sa.INTEGER(), nullable=True),
        sa.Column("car_number_range_end", sa.INTEGER(), nullable=True),
        sa.ForeignKeyConstraint(["den_id"], ["dens.id"]),
        sa.ForeignKeyConstraint(["race_id"], ["races.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_racing_groups_id", "racing_groups", ["id"], unique=False)

    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("racing_group_id", sa.INTEGER(), nullable=True))
        batch_op.create_foreign_key(
            "fk_racers_racing_group_id", "racing_groups", ["racing_group_id"], ["id"]
        )
