"""``tracks.timer_type`` gains a fourth value: ``NONE`` (#490).

A no-op, and deliberately checked in as one rather than skipped. `TimerType`
is a Python-side ``str`` enum (`backend/db/models.py`) and the column is
`SAEnum(TimerType)` with no ``create_constraint`` — SQLite has no native enum
type, and this project never asked SQLAlchemy for the CHECK constraint that
would otherwise enforce one, so the column is a plain ``VARCHAR`` and a new
enum member changes nothing a migration can see. ``alembic revision
--autogenerate`` confirms that: run against a database at ``0026``, it
produced this file with nothing in either direction.

The revision still exists because `CLAUDE.md` is explicit that a model change
gets a migration, and because leaving one out is how "does `alembic check`
agree with `models.py`" stops being a question with one answer per column —
the reader would otherwise have to know, for every ``Enum`` in the tree,
whether *this* one was constrained. Recording "no, checked" beats leaving that
unanswered.

Revision ID: 0027_no_timer_type
Revises: 0026_award_voting
Create Date: 2026-08-29

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0027_no_timer_type"
down_revision: str | Sequence[str] | None = "0026_award_voting"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Nothing to do — see the module docstring."""


def downgrade() -> None:
    """Nothing to do — see the module docstring."""
