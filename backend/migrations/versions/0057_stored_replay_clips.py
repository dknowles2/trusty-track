"""Stored replay clips (#177 stage 2).

`organizations.keep_replays` is the setting, off by default (`server_default`
matches the model's own Python-side default, the same shape `debug_mode`
follows) — an install upgrading into this keeps stage 1a's exact
delete-after-next-heat behaviour until an operator opts in. The two bound
columns, `replay_retention_heats`/`replay_retention_mb`, are independent and
nullable: null means unbounded at that one dimension, and both null (the
state every existing install starts in once the setting is turned on) means
genuinely unbounded — an operator's own choice, not a default this migration
invents on their behalf.

`heat_replays` is new: one row per camera's clip, written only once
`keep_replays` was on at upload time (`services.replays.record_stored_clip`).
`heat_id` carries `ON DELETE CASCADE`, the same "deletion is the schema's
job" rule `heat_lanes` follows (#125) — a heat gone from the schedule leaves
no clip worth a database row, though the *file* still needs an explicit
delete since SQLite cannot also remove one for us (see
`services.replays.discard_clips_for_race`).

The downgrade drops both new columns and the whole table outright. Any clip
an operator has kept by the time somebody rolls back is lost — the same
trade every other purely additive column in this history takes (`home_unit`,
the terminology overrides) — and the files under `DATA_DIR/replays/`
themselves are untouched either way, since this migration only ever
described the database's view of them.

Revision ID: 0057_stored_replay_clips
Revises: 0056_racer_home_unit
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0057_stored_replay_clips"
down_revision: str | Sequence[str] | None = "0056_racer_home_unit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "heat_replays",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("heat_id", sa.Integer(), nullable=False),
        sa.Column("camera_id", sa.String(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("t0_offset_ms", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["heat_id"], ["heats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("heat_replays", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_heat_replays_heat_id"), ["heat_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_heat_replays_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_heat_replays_recorded_at"), ["recorded_at"], unique=False
        )

    with op.batch_alter_table("organizations", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "keep_replays",
                sa.Boolean(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column("replay_retention_heats", sa.Integer(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("replay_retention_mb", sa.Integer(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("organizations", schema=None) as batch_op:
        batch_op.drop_column("replay_retention_mb")
        batch_op.drop_column("replay_retention_heats")
        batch_op.drop_column("keep_replays")

    with op.batch_alter_table("heat_replays", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_heat_replays_recorded_at"))
        batch_op.drop_index(batch_op.f("ix_heat_replays_id"))
        batch_op.drop_index(batch_op.f("ix_heat_replays_heat_id"))

    op.drop_table("heat_replays")
