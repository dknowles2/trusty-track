"""Reading a DerbyNet database (#661).

Two layers, tested from both sides, the same shape as `test_gprm_import.py`:
`domain/derbynet.py` is the mapping rule over plain rows, pinned here through
a hand-built `TableSet` so each branch can be reached with one row;
`services/importers/derbynet.py` is the file, pinned against a SQLite
database built from `roster_imports/derbynet.sql` — see the NOTICE there for
how much that fixture can and cannot prove.

`domain/gprm.py`'s own tests already cover everything DerbyNet's schema
shares with GPRM's — the racer fields, the class/rank grouping, the
duplicate-number rule. This file is about what `domain/derbynet.py` adds on
top: the `Partitions` table, and the one problem message that must say
"DerbyNet" rather than "GrandPrix Race Manager".
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from backend.domain import derbynet
from backend.domain.roster_import import ImportedGroup, RosterImportError
from backend.services.importers.derbynet import (
    NO_ROSTER_MESSAGE,
    NOT_A_DATABASE_MESSAGE,
    parse_derbynet_database,
)

FIXTURES = Path(__file__).parent / "roster_imports"


class Tables:
    """A `TableSet` made of literals -- the same helper `test_gprm_import.py` uses."""

    def __init__(self, **tables: Sequence[Mapping[str, object]]) -> None:
        self._tables = {name.lower(): rows for name, rows in tables.items()}

    def has_table(self, name: str) -> bool:
        return name.lower() in self._tables

    def rows(self, name: str) -> Sequence[Mapping[str, object]]:
        return self._tables.get(name.lower(), [])


def _racer(**columns: object) -> dict[str, object]:
    row: dict[str, object] = {
        "racerid": 1,
        "carnumber": 1,
        "carname": None,
        "lastname": "Rivera",
        "firstname": "Alex",
        "classid": 1,
        "rankid": 1,
        "passedinspection": 0,
        "imagefile": None,
        "carphoto": None,
        "exclude": 0,
    }
    row.update(columns)
    return row


@pytest.fixture
def derbynet_file(tmp_path: Path) -> Path:
    path = tmp_path / "derbynet.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript((FIXTURES / "derbynet.sql").read_text())
    connection.commit()
    connection.close()
    return path


# --- the file -----------------------------------------------------------


def test_the_fixture_reads_as_groups_and_racers(derbynet_file: Path) -> None:
    roster = parse_derbynet_database(derbynet_file)

    assert roster.groups == (
        ImportedGroup("Wolves"),
        ImportedGroup("Bears"),
        ImportedGroup("Den 4", division="Webelos"),
        ImportedGroup("Den 5", division="Webelos"),
        # The rank's own name is `siblings-legacy`; its Partitions row calls
        # it "Siblings", matching its class -- no category, same as Wolves
        # and Bears reads under the by-partition default.
        ImportedGroup("Siblings"),
    )


def test_grand_finals_is_a_derbynet_aggregate_and_not_a_group(
    derbynet_file: Path,
) -> None:
    roster = parse_derbynet_database(derbynet_file)
    assert "Grand Finals" not in [g.name for g in roster.groups]


def test_the_excluded_racer_still_imports_flagged(derbynet_file: Path) -> None:
    """DerbyNet's own `exclude` column leaves a racer's results in its
    standings page, only off the trophy table (#548's own semantics) -- the
    racer still imports, just flagged."""
    roster = parse_derbynet_database(derbynet_file)
    pat = next(r for r in roster.racers if r.first_name == "Pat")
    assert pat.excluded_from_standings is True
    assert pat.group == "Siblings"


def test_the_photo_warning_names_derbynet_not_gprm(derbynet_file: Path) -> None:
    roster = parse_derbynet_database(derbynet_file)
    photo_problems = [p for p in roster.problems if "photos in" in p.message]
    assert len(photo_problems) == 1
    assert "photos in DerbyNet" in photo_problems[0].message
    assert "GrandPrix Race Manager" not in photo_problems[0].message


def test_parsing_leaves_the_file_byte_for_byte_unchanged(derbynet_file: Path) -> None:
    before = derbynet_file.read_bytes()
    parse_derbynet_database(derbynet_file)
    assert derbynet_file.read_bytes() == before


def test_a_csv_is_not_a_database(tmp_path: Path) -> None:
    csv = tmp_path / "roster.csv"
    csv.write_text("first_name,last_name\nAlex,Rivera\n")
    with pytest.raises(RosterImportError) as refused:
        parse_derbynet_database(csv)
    assert str(refused.value) == NOT_A_DATABASE_MESSAGE


def test_a_truncated_database_is_not_a_database(derbynet_file: Path) -> None:
    derbynet_file.write_bytes(derbynet_file.read_bytes()[:100])
    with pytest.raises(RosterImportError) as refused:
        parse_derbynet_database(derbynet_file)
    assert str(refused.value) == NOT_A_DATABASE_MESSAGE


def test_a_sqlite_file_without_the_racer_table_is_refused(tmp_path: Path) -> None:
    other = tmp_path / "trusty-track.db"
    connection = sqlite3.connect(other)
    connection.execute("CREATE TABLE racers (id INTEGER PRIMARY KEY)")
    connection.commit()
    connection.close()
    with pytest.raises(RosterImportError) as refused:
        parse_derbynet_database(other)
    assert str(refused.value) == NO_ROSTER_MESSAGE


def test_the_vehicle_word_reaches_the_sentences(tmp_path: Path) -> None:
    path = tmp_path / "one.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript(
        "CREATE TABLE RegistrationInfo (RacerID INTEGER, CarNumber TEXT, "
        "LastName TEXT, FirstName TEXT);"
        "INSERT INTO RegistrationInfo VALUES (1, 'ABC', 'Rivera', 'Alex');"
    )
    connection.commit()
    connection.close()
    roster = parse_derbynet_database(path, vehicle_word="Rocket")
    assert any(m.message.startswith('Rocket number "ABC"') for m in roster.problems)


# --- the Partitions rule --------------------------------------------------


def test_a_rank_with_no_matching_partition_reads_as_gprm_already_does() -> None:
    """No `Partitions` table at all -- a GPRM file, or an older DerbyNet
    schema -- must behave exactly like `gprm.roster_from_tables`."""
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"rankid": 1, "rank": "Den 3", "classid": 1}],
            RegistrationInfo=[],
        )
    )
    assert roster.groups == (ImportedGroup("Den 3", division="Wolves"),)


def test_a_partition_renames_a_stale_rank() -> None:
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"rankid": 1, "rank": "old-name", "classid": 1}],
            Partitions=[{"partitionid": 1, "name": "Wolves", "rankid": 1}],
            RegistrationInfo=[_racer(rankid=1, classid=1)],
        )
    )
    assert roster.groups == (ImportedGroup("Wolves", division=None),)
    assert roster.racers[0].group == "Wolves"


def test_a_partition_for_a_rank_no_racer_uses_costs_nothing() -> None:
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"rankid": 1, "rank": "Den 1", "classid": 1}],
            Partitions=[{"partitionid": 1, "name": "Den 1", "rankid": 2}],
            RegistrationInfo=[_racer(rankid=1, classid=1)],
        )
    )
    assert roster.groups == (ImportedGroup("Den 1", division="Wolves"),)


def test_two_partitions_naming_the_same_rank_take_the_lowest_id() -> None:
    """Only reachable through DerbyNet's "custom" grouping rule -- a
    deterministic answer beats one depending on row order."""
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"rankid": 1, "rank": "old-name", "classid": 1}],
            Partitions=[
                {"partitionid": 5, "name": "Second", "rankid": 1},
                {"partitionid": 2, "name": "First", "rankid": 1},
            ],
            RegistrationInfo=[],
        )
    )
    assert roster.groups == (ImportedGroup("First", division="Wolves"),)


def test_a_partition_row_missing_a_name_or_rank_is_ignored() -> None:
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"rankid": 1, "rank": "Den 1", "classid": 1}],
            Partitions=[
                {"partitionid": 1, "name": None, "rankid": 1},
                {"partitionid": 2, "name": "Orphan", "rankid": None},
            ],
            RegistrationInfo=[],
        )
    )
    assert roster.groups == (ImportedGroup("Den 1", division="Wolves"),)


def test_partition_column_names_match_case_insensitively() -> None:
    roster = derbynet.roster_from_derbynet_tables(
        Tables(
            Classes=[{"classid": 1, "class": "Wolves"}],
            Ranks=[{"RankID": 1, "Rank": "old-name", "ClassID": 1}],
            Partitions=[{"PartitionID": 1, "Name": "Wolves", "RankID": 1}],
            RegistrationInfo=[],
        )
    )
    assert roster.groups == (ImportedGroup("Wolves", division=None),)


def test_looks_like_derbynet_matches_looks_like_gprm() -> None:
    empty = Tables()
    with_racers = Tables(RegistrationInfo=[])
    assert derbynet.looks_like_derbynet(empty) is False
    assert derbynet.looks_like_derbynet(with_racers) is True
