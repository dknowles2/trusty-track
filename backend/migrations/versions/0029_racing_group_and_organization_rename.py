"""Rename ``dens``/``groups`` to ``racing_groups``/``organizations`` (#496, stage 1).

Stage 1 of untying the data model from Scouting vocabulary: the *code* word
for a concept becomes neutral, while what the operator's screen calls it stays
theirs to configure (a later stage). This migration is the storage half —
models, CRUD, the domain layer and the GraphQL schema are renamed alongside it
in the same change, with no behaviour change and no new setting.

Four things move:

1. ``dens`` -> ``racing_groups``, with ``racers.den_id``, ``rounds.den_id`` and
   ``awards.den_id`` following as ``racing_group_id``.
2. ``groups`` -> ``organizations``, with ``races.group_id`` following as
   ``organization_id``.
3. The advancement/award source vocabulary stored in
   ``rounds.advancement_source`` and ``awards.source``: ``"PACK"`` becomes
   ``"ALL"`` and ``"DEN"`` becomes ``"EACH_GROUP"``. Unlike the rank-to-division
   mapping a later stage adds, this is an exact 1:1 string swap in both
   directions, so the downgrade loses nothing.
4. The renamed tables' indexes, so a fresh install and an upgraded one agree
   (``alembic check`` does not compare index names on its own, and
   ``test_an_adopted_database_ends_up_with_the_same_schema`` does).

A table is renamed with a plain ``RENAME TO`` rather than dropped and
recreated. SQLite rewrites the ``REFERENCES`` clause of every table pointing
at the one being renamed (including its ``ON DELETE`` action) as part of that
statement, so ``awards.racing_group_id`` keeps its ``ON DELETE CASCADE``
without this migration having to restate it. The column renames that follow
run through ``batch_alter_table``, which reflects the table's current
(already-renamed) foreign keys before recreating it, so nothing is lost
there either.

One hazard worth naming rather than hiding: ``0008_drop_racing_groups``
already dropped a table called ``racing_groups``, a shadow of the old ``Den``
concept nothing ever read. Reusing that name here does **not** resurrect it —
by the time this migration runs, ``0008`` is many releases behind and the name
has been free the whole time. Downgrading past this migration renames the
table back to ``dens`` *before* ``0008``'s own downgrade runs (migrations
unwind in reverse), so the old shadow table's downgrade finds the name free
again too. ``test_every_downgrade_runs_and_lands_back_at_the_same_schema``
walks the full chain and would catch it if that ordering were ever wrong.

Revision ID: 0029_racing_group_and_organization_rename
Revises: 0028_appearance_themes
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0029_racing_group_and_organization_rename"
down_revision: str | Sequence[str] | None = "0028_appearance_themes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- dens -> racing_groups -------------------------------------------
    op.rename_table("dens", "racing_groups")
    with op.batch_alter_table("racing_groups", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_dens_id"))
        batch_op.drop_index(batch_op.f("ix_dens_name"))
        batch_op.create_index(batch_op.f("ix_racing_groups_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_racing_groups_name"), ["name"], unique=False
        )

    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.alter_column("den_id", new_column_name="racing_group_id")
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column("den_id", new_column_name="racing_group_id")
    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.alter_column("den_id", new_column_name="racing_group_id")

    # --- groups -> organizations -------------------------------------------
    op.rename_table("groups", "organizations")
    with op.batch_alter_table("organizations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_groups_id"))
        batch_op.drop_index(batch_op.f("ix_groups_name"))
        batch_op.create_index(batch_op.f("ix_organizations_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_organizations_name"), ["name"], unique=True
        )

    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.alter_column("group_id", new_column_name="organization_id")

    # --- stored source vocabulary -------------------------------------------
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE rounds SET advancement_source = 'ALL' "
            "WHERE advancement_source = 'PACK'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE rounds SET advancement_source = 'EACH_GROUP' "
            "WHERE advancement_source = 'DEN'"
        )
    )
    conn.execute(sa.text("UPDATE awards SET source = 'ALL' WHERE source = 'PACK'"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE awards SET source = 'PACK' WHERE source = 'ALL'"))
    conn.execute(
        sa.text(
            "UPDATE rounds SET advancement_source = 'PACK' "
            "WHERE advancement_source = 'ALL'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE rounds SET advancement_source = 'DEN' "
            "WHERE advancement_source = 'EACH_GROUP'"
        )
    )

    with op.batch_alter_table("races", schema=None) as batch_op:
        batch_op.alter_column("organization_id", new_column_name="group_id")

    with op.batch_alter_table("organizations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_organizations_name"))
        batch_op.drop_index(batch_op.f("ix_organizations_id"))
        batch_op.create_index(batch_op.f("ix_groups_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_groups_name"), ["name"], unique=True)
    op.rename_table("organizations", "groups")

    with op.batch_alter_table("awards", schema=None) as batch_op:
        batch_op.alter_column("racing_group_id", new_column_name="den_id")
    with op.batch_alter_table("rounds", schema=None) as batch_op:
        batch_op.alter_column("racing_group_id", new_column_name="den_id")
    with op.batch_alter_table("racers", schema=None) as batch_op:
        batch_op.alter_column("racing_group_id", new_column_name="den_id")

    with op.batch_alter_table("racing_groups", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_racing_groups_name"))
        batch_op.drop_index(batch_op.f("ix_racing_groups_id"))
        batch_op.create_index(batch_op.f("ix_dens_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_dens_name"), ["name"], unique=False)
    op.rename_table("racing_groups", "dens")
