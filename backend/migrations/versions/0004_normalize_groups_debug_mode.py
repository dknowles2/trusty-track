"""normalize groups.debug_mode nullability on legacy-adopted databases

Issue #32. A database adopted from the pre-Alembic era ended up with a
*different schema* from a freshly created one, which is the exact thing
adopting Alembic (#3) was supposed to make impossible.

``0002`` adds the column only when it is missing, because the old hand-rolled
``ALTER TABLE`` may or may not have run. That is right as far as it goes, but
the old statement never declared ``NOT NULL``, so an install where it *did* run
keeps a nullable column forever while a fresh install gets ``NOT NULL``.

This rewrites the column to match the model on any database where it does not
already. SQLite cannot alter a column in place, so ``batch_alter_table`` copies
the table — which is also why this checks first rather than doing it
unconditionally: on a fresh database there is nothing to fix and no reason to
rebuild ``groups``.

Revision ID: 0004_debug_mode_notnull
Revises: 0003_heat_lanes
Create Date: 2026-07-25

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_debug_mode_notnull"
down_revision: Union[str, Sequence[str], None] = "0003_heat_lanes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _debug_mode_column() -> Union[dict, None]:
    inspector = sa.inspect(op.get_bind())
    if "groups" not in set(inspector.get_table_names()):
        return None
    for column in inspector.get_columns("groups"):
        if column["name"] == "debug_mode":
            return column
    return None


def upgrade() -> None:
    column = _debug_mode_column()
    if column is None or not column["nullable"]:
        return

    # A nullable column can hold NULLs. Nothing writes them today, but the
    # column has been nullable on these installs since before Alembic, so
    # settle the data before tightening the constraint.
    op.execute(sa.text("UPDATE groups SET debug_mode = 0 WHERE debug_mode IS NULL"))

    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.alter_column(
            "debug_mode",
            existing_type=sa.Boolean(),
            nullable=False,
            existing_server_default=sa.false(),
        )


def downgrade() -> None:
    """Make the column nullable again.

    Not a true inverse — this cannot know which databases were nullable before
    — but it restores the looser of the two schemas, which is the one that
    accepts either.
    """
    if _debug_mode_column() is None:
        return
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.alter_column(
            "debug_mode",
            existing_type=sa.Boolean(),
            nullable=True,
            existing_server_default=sa.false(),
        )
