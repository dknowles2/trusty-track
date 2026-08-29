"""``racing_groups.rank`` (a seven-value ``Rank`` enum) becomes free text:
``division`` (#496, stage 2).

Independent of stage 1's rename — this column held a Cub Scout rank
(``LION`` through ``ARROW_OF_LIGHT``) and nothing server-side ever read it to
decide anything: `services/scoring.py` passes it straight through onto the
leaderboard for branding (#298). Nothing structural is lost by making it
text, and a school or a 4-H club typing "3rd Grade" is exactly as valid as a
pack picking "Wolf" from a preset list — the frontend offers the traditional
Cub Scout ranks as picker *suggestions* now (`categoryPresets.ts`), not a
constraint.

Unlike stage 1's advancement-source swap, this data mapping is **not**
exactly reversible. Upgrading carries every stored enum code to the display
label `rankLabel()` used to compute (``LION`` to ``"Lion"``,
``ARROW_OF_LIGHT`` to ``"Arrow of Light"``) — an exact mapping, since the
column could previously hold only those seven codes. Downgrading reverses it
by exact label match and sends anything else — a school's ``"3rd Grade"``, a
pack's own re-typing of ``"wolf"`` in different case — to ``OTHER``. That is
lossy and deliberate: it is the same fallback `rankLabel()` already applied
to a value the frontend's list did not recognise, and the alternative is
refusing the downgrade outright over data the enum was never able to hold in
the first place.

The column itself carries no ``CHECK`` constraint to drop: `SAEnum` is used
throughout this codebase with no ``create_constraint`` (see
`0027_no_timer_type`'s docstring), so on SQLite ``rank`` was already a plain
``VARCHAR`` and this migration's schema half is a rename plus a type
annotation change, not a constraint removal.

Revision ID: 0030_racing_group_division
Revises: 0029_racing_group_and_organization_rename
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0030_racing_group_division"
down_revision: str | Sequence[str] | None = "0029_racing_group_and_organization_rename"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RANK_LABELS = (
    ("LION", "Lion"),
    ("TIGER", "Tiger"),
    ("WOLF", "Wolf"),
    ("BEAR", "Bear"),
    ("WEBELOS", "Webelos"),
    ("ARROW_OF_LIGHT", "Arrow of Light"),
    ("OTHER", "Other"),
)

_RANK_ENUM = sa.Enum(*(code for code, _label in _RANK_LABELS), name="rank")


def upgrade() -> None:
    conn = op.get_bind()
    for code, label in _RANK_LABELS:
        conn.execute(
            sa.text("UPDATE racing_groups SET rank = :label WHERE rank = :code"),
            {"label": label, "code": code},
        )

    with op.batch_alter_table("racing_groups", schema=None) as batch_op:
        batch_op.alter_column(
            "rank",
            new_column_name="division",
            existing_type=_RANK_ENUM,
            type_=sa.String(),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("racing_groups", schema=None) as batch_op:
        batch_op.alter_column(
            "division",
            new_column_name="rank",
            existing_type=sa.String(),
            type_=_RANK_ENUM,
            existing_nullable=True,
        )

    conn = op.get_bind()
    for code, label in _RANK_LABELS:
        conn.execute(
            sa.text("UPDATE racing_groups SET rank = :code WHERE rank = :label"),
            {"code": code, "label": label},
        )
    # Anything left is a value only free text could hold — lossy, and said so
    # in the module docstring.
    known_codes = ", ".join(f"'{code}'" for code, _label in _RANK_LABELS)
    conn.execute(
        sa.text(
            "UPDATE racing_groups SET rank = 'OTHER' "
            f"WHERE rank IS NOT NULL AND rank NOT IN ({known_codes})"
        )
    )
