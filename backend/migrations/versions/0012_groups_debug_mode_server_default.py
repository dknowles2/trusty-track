"""restore the server default on groups.debug_mode

Issue #32 again, by a route it did not cover. ``0004`` fixed the *nullability*
of this column on adopted databases, and the test that proved it asked
``alembic check`` — which does not compare server defaults. So a third legacy
shape went unnoticed:

* the old hand-rolled ``ALTER TABLE`` left ``BOOLEAN DEFAULT 0``, nullable, and
  ``0004`` tightens it;
* a database from before the column existed has no column at all, and ``0002``
  adds it correctly;
* **``create_all()`` left ``BOOLEAN NOT NULL`` with no server default** — the
  model carried only a Python-side ``default=False``. ``0002`` sees the column
  and skips, ``0004`` sees it is already NOT NULL and skips, and nothing ever
  adds the default.

That third shape is every ``v1.0.0`` install, because ``create_all()`` ran
before the hand-rolled ALTER could find anything to do.

Nothing reads the default today — the ORM supplies the value on every insert,
which is exactly why this was invisible. It matters because ``models.py``
declares ``server_default=false()`` and the next migration that adds a NOT NULL
column to a populated table will need it to actually be there, and because an
adopted install differing from a fresh one is the failure #3 was adopted to
prevent.

Revision ID: 0012_debug_mode_default
Revises: 0011_track_timer_profile
Create Date: 2026-08-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_debug_mode_default"
down_revision: str | Sequence[str] | None = "0011_track_timer_profile"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _debug_mode_column() -> dict | None:
    inspector = sa.inspect(op.get_bind())
    if "groups" not in set(inspector.get_table_names()):
        return None
    for column in inspector.get_columns("groups"):
        if column["name"] == "debug_mode":
            return column
    return None


def upgrade() -> None:
    column = _debug_mode_column()
    if column is None or column["default"] is not None:
        # Checked rather than done unconditionally: SQLite cannot alter a column
        # in place, so this copies the table, and there is no reason to rebuild
        # `groups` on the installs that are already right.
        return

    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.alter_column(
            "debug_mode",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            server_default=sa.false(),
        )


def downgrade() -> None:
    """Drop the server default again.

    Not a true inverse — this cannot know which databases lacked it before, so
    it removes it everywhere, which is the state `0011` left a fresh install in
    only for adopted ones. Harmless either way: nothing depends on the default.
    """
    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.alter_column(
            "debug_mode",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            server_default=None,
        )
