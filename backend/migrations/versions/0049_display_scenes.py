"""Display scenes: scenes, scene_assignments (#613)

A scene is a named recipe for what every audience display should show at
once — "Check-In", "Racing", "Awards", or whatever custom layout an
operator composes for their own venue. Unlike a `Display`'s own live
assignment, which stays entirely in memory (`services/displays.py`), a
scene is something the operator spent real time composing and wants to
survive a restart, so it is stored.

`scenes` is race-scoped and cascade-deleted with the race, the same shape
as `racing_groups` and `awards`. `scene_assignments` holds one row per
display named in a scene, carrying a whole assignment (view plus every
rider) rather than the view alone — see `backend/domain/scenes.py` for why.
`display_id` is not a foreign key: a `Display` is presence, held only in
the in-memory registry, and there is no row here for it to reference.

Revision ID: 0049_display_scenes
Revises: 0048_round_field_pinned
Create Date: 2026-09-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0049_display_scenes"
down_revision: str | Sequence[str] | None = "0048_round_field_pinned"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "scenes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("race_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["race_id"], ["races.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("race_id", "name", name="uq_scene_race_name"),
    )
    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_scenes_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_scenes_race_id"), ["race_id"], unique=False
        )

    op.create_table(
        "scene_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scene_id", sa.Integer(), nullable=False),
        sa.Column("display_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column(
            "view",
            sa.Enum(
                "STANDINGS",
                "TIMING",
                "CYCLE",
                "PROJECTOR",
                "AWARDS",
                "SLIDESHOW",
                "STANDINGS_ONLY",
                "CHECKIN",
                "QRCODE",
                "OVERLAY",
                name="displayview",
            ),
            nullable=False,
        ),
        sa.Column(
            "cycle_seconds", sa.Integer(), server_default=sa.text("10"), nullable=False
        ),
        sa.Column(
            "scroll_behavior",
            sa.Enum("PAGING", "SMOOTH", name="scrollbehavior"),
            server_default=sa.text("'PAGING'"),
            nullable=False,
        ),
        sa.Column(
            "show_checked_in",
            sa.Boolean(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "qr_target",
            sa.Enum("STANDINGS", "VOTE", name="qrtarget"),
            server_default=sa.text("'STANDINGS'"),
            nullable=False,
        ),
        sa.Column(
            "show_standings_ticker",
            sa.Boolean(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["scene_id"], ["scenes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "scene_id", "display_id", name="uq_scene_assignment_display"
        ),
    )
    with op.batch_alter_table("scene_assignments", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_scene_assignments_id"), ["id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_scene_assignments_scene_id"), ["scene_id"], unique=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("scene_assignments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_scene_assignments_scene_id"))
        batch_op.drop_index(batch_op.f("ix_scene_assignments_id"))

    op.drop_table("scene_assignments")
    with op.batch_alter_table("scenes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_scenes_race_id"))
        batch_op.drop_index(batch_op.f("ix_scenes_id"))

    op.drop_table("scenes")
