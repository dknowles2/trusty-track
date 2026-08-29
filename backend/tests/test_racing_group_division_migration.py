"""``0030_racing_group_division``: the rank enum carried to free text.

The schema half is exercised by the generic migration tests in
`test_migrations.py` (every downgrade runs and lands back at the same
schema). What is specific to this migration, and worth pinning on its own, is
the *data* mapping — an enum code carried to the display string `rankLabel()`
used to compute, and the downgrade's lossy fallback for anything that is not
one of the seven known codes or labels (#496, stage 2).
"""

from pathlib import Path

from sqlalchemy import create_engine, text

from backend.tests.helpers import run_alembic

TARGET = "0030_racing_group_division"
PRIOR = "0029_racing_group_and_organization_rename"


def _seed_racing_groups(db: Path, rows: list[tuple[int, str, str | None]]) -> None:
    """Insert racing groups (and the race/track/org they need) holding ``rank``."""
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO organizations (id, name) VALUES (1, 'Pack 1')")
            )
            conn.execute(
                text(
                    "INSERT INTO tracks (id, name, lane_count, timer_type,"
                    " remote_start_installed) VALUES (1, 'Main', 4, 'FAKE', 0)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO races (id, organization_id, track_id, name,"
                    " car_numbering_strategy, global_start_number,"
                    " championship_trophies, scoring_strategy, auto_advance_heat)"
                    " VALUES (1, 1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
                )
            )
            for row_id, name, rank in rows:
                conn.execute(
                    text(
                        "INSERT INTO racing_groups (id, race_id, name, color, rank)"
                        " VALUES (:id, 1, :name, '#000000', :rank)"
                    ),
                    {"id": row_id, "name": name, "rank": rank},
                )
    finally:
        engine.dispose()


def _divisions(db: Path) -> dict[int, str | None]:
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id, division FROM racing_groups ORDER BY id")
            ).all()
    finally:
        engine.dispose()
    return {row[0]: row[1] for row in rows}


def _ranks(db: Path) -> dict[int, str | None]:
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT id, rank FROM racing_groups ORDER BY id")
            ).all()
    finally:
        engine.dispose()
    return {row[0]: row[1] for row in rows}


def test_upgrade_carries_every_enum_code_to_its_display_label(tmp_path):
    assert run_alembic(tmp_path, "upgrade", PRIOR).returncode == 0
    db = tmp_path / "trusty-track.db"
    _seed_racing_groups(
        db,
        [
            (1, "Lions", "LION"),
            (2, "Tigers", "TIGER"),
            (3, "Wolves", "WOLF"),
            (4, "Bears", "BEAR"),
            (5, "Webelos", "WEBELOS"),
            (6, "Arrows", "ARROW_OF_LIGHT"),
            (7, "Others", "OTHER"),
            (8, "Unranked", None),
        ],
    )

    assert run_alembic(tmp_path, "upgrade", TARGET).returncode == 0

    assert _divisions(db) == {
        1: "Lion",
        2: "Tiger",
        3: "Wolf",
        4: "Bear",
        5: "Webelos",
        6: "Arrow of Light",
        7: "Other",
        8: None,
    }


def test_downgrade_reverses_the_labels_and_loses_anything_else(tmp_path):
    """The downgrade is lossy by design — anything not a known label becomes
    ``OTHER`` rather than refusing, and the docstring says so."""
    assert run_alembic(tmp_path, "upgrade", TARGET).returncode == 0
    db = tmp_path / "trusty-track.db"
    engine = create_engine(f"sqlite:///{db}")
    try:
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO organizations (id, name) VALUES (1, 'Pack 1')")
            )
            conn.execute(
                text(
                    "INSERT INTO tracks (id, name, lane_count, timer_type,"
                    " remote_start_installed) VALUES (1, 'Main', 4, 'FAKE', 0)"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO races (id, organization_id, track_id, name,"
                    " car_numbering_strategy, global_start_number,"
                    " championship_trophies, scoring_strategy, auto_advance_heat)"
                    " VALUES (1, 1, 1, 'Derby', 'MANUAL', 1, 3, 'TIMED', 0)"
                )
            )
            for row_id, name, division in [
                (1, "Wolves", "Wolf"),
                (2, "Unranked", None),
                (3, "Third Graders", "3rd Grade"),  # a school's own category
            ]:
                conn.execute(
                    text(
                        "INSERT INTO racing_groups"
                        " (id, race_id, name, color, division)"
                        " VALUES (:id, 1, :name, '#000000', :division)"
                    ),
                    {"id": row_id, "name": name, "division": division},
                )
    finally:
        engine.dispose()

    assert run_alembic(tmp_path, "downgrade", PRIOR).returncode == 0

    assert _ranks(db) == {
        1: "WOLF",
        2: None,
        3: "OTHER",  # lossy: the enum never had room for "3rd Grade"
    }
