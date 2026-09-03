"""Reading a GrandPrix Race Manager database (#618, stage 1).

Two layers, tested from both sides. `domain/gprm.py` is the mapping rule
over plain rows, pinned here through a hand-built `TableSet` so each branch
can be reached with one row; `services/importers/gprm.py` is the file, pinned
against a SQLite database built from `roster_imports/gprm-v18.sql` — see the
NOTICE there for how much that fixture can and cannot prove.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from backend.domain import gprm
from backend.domain.roster_import import (
    ImportedGroup,
    ImportedRacer,
    ImportProblem,
    ParsedRoster,
    RosterImportError,
    duplicate_number_problems,
)
from backend.services.importers import sqlite_tables
from backend.services.importers.gprm import (
    ACCESS_MESSAGE,
    NO_ROSTER_MESSAGE,
    NOT_A_DATABASE_MESSAGE,
    parse_gprm_database,
)

FIXTURES = Path(__file__).parent / "roster_imports"


class Tables:
    """A `TableSet` made of literals."""

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


ONE_CLASS = [{"classid": 1, "class": "Wolves"}]
ONE_RANK = [{"rankid": 1, "rank": "Wolves", "classid": 1}]


@pytest.fixture
def gprm_file(tmp_path: Path) -> Path:
    path = tmp_path / "GPRM Data.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript((FIXTURES / "gprm-v18.sql").read_text())
    connection.commit()
    connection.close()
    return path


# --- the file ---------------------------------------------------------------


def test_the_fixture_reads_as_groups_and_racers(gprm_file: Path) -> None:
    roster = parse_gprm_database(gprm_file)

    assert roster.groups == (
        # Bears sorts first by `sortorder`, against its id.
        ImportedGroup("Bears"),
        ImportedGroup("Bears Den 1", division="Bears"),
        ImportedGroup("Wolves"),
        ImportedGroup("Wolves Den 1", division="Wolves"),
        ImportedGroup("Den 4", division="Webelos"),
        ImportedGroup("Den 5", division="Webelos"),
        ImportedGroup("Siblings"),
        # Racer 6's rank is gone; the class it was in becomes a group for them.
        ImportedGroup("Webelos"),
    )
    assert [racer.source_id for racer in roster.racers] == [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "8",
        "9",
        "10",
    ]


def test_every_racer_field_lands(gprm_file: Path) -> None:
    roster = parse_gprm_database(gprm_file)
    by_id = {racer.source_id: racer for racer in roster.racers}

    assert by_id["1"] == ImportedRacer(
        first_name="Alex",
        last_name="Rivera",
        car_number=101,
        car_name="Blue Streak",
        passed_inspection=True,
        group="Wolves",
        source_id="1",
    )
    assert by_id["4"].car_name == "Lightning"  # trimmed
    assert by_id["4"].group == "Bears Den 1"
    assert by_id["6"].group == "Webelos"
    assert by_id["9"] == ImportedRacer(
        first_name="Pat",
        last_name="Rivera",
        car_number=None,
        car_name="Dad's Car",
        passed_inspection=True,
        group="Siblings",
        excluded_from_standings=True,
        source_id="9",
    )
    assert by_id["10"].car_number is None


def test_the_problems_read_in_roster_order_then_duplicates_then_photos(
    gprm_file: Path,
) -> None:
    roster = parse_gprm_database(gprm_file)

    assert [problem.message for problem in roster.problems] == [
        "Missing a first or last name — this racer will be skipped.",
        'Car number "ABC" is not a whole number — it will be left blank.',
        "Car number 101 is already used by Alex Rivera.",
        "2 racers have photos in GrandPrix Race Manager that are stored as "
        "separate files, not in the database — they will need uploading again "
        "after the import.",
    ]
    assert roster.can_import
    assert [problem.source_id for problem in roster.problems] == [
        "7",
        "10",
        "8",
        None,
    ]


def test_a_missing_rank_falls_back_to_the_class_without_a_problem(
    gprm_file: Path,
) -> None:
    """Racer 6's rank is missing but their class is not — that is the
    fallback working, and it must not be reported as a lost group."""
    roster = parse_gprm_database(gprm_file)
    messages = [p.message for p in roster.problems if p.source_id == "6"]
    assert messages == [], messages


def test_the_vehicle_word_reaches_the_sentences(gprm_file: Path) -> None:
    roster = parse_gprm_database(gprm_file, vehicle_word="Rocket")
    assert any(m.message.startswith("Rocket number 101") for m in roster.problems)
    assert any(m.message.startswith('Rocket number "ABC"') for m in roster.problems)


def test_parsing_leaves_the_file_byte_for_byte_unchanged(gprm_file: Path) -> None:
    """The operator handed over the only copy. Not a journal, not a `-wal`."""
    before = gprm_file.read_bytes()
    siblings_before = sorted(p.name for p in gprm_file.parent.iterdir())

    parse_gprm_database(gprm_file)

    assert gprm_file.read_bytes() == before
    assert sorted(p.name for p in gprm_file.parent.iterdir()) == siblings_before


def test_an_access_database_is_refused_by_name(tmp_path: Path) -> None:
    mdb = tmp_path / "GPRM.mdb"
    mdb.write_bytes(b"\x00\x01\x00\x00Standard Jet DB\x00" + b"\x00" * 64)

    with pytest.raises(RosterImportError) as refused:
        parse_gprm_database(mdb)
    assert str(refused.value) == ACCESS_MESSAGE


def test_a_csv_is_not_a_database(tmp_path: Path) -> None:
    csv = tmp_path / "roster.csv"
    csv.write_text("first_name,last_name\nAlex,Rivera\n")

    with pytest.raises(RosterImportError) as refused:
        parse_gprm_database(csv)
    assert str(refused.value) == NOT_A_DATABASE_MESSAGE


def test_a_truncated_database_is_not_a_database(gprm_file: Path) -> None:
    """Starts like SQLite, is not one all the way through."""
    gprm_file.write_bytes(gprm_file.read_bytes()[:100])

    with pytest.raises(RosterImportError) as refused:
        parse_gprm_database(gprm_file)
    assert str(refused.value) == NOT_A_DATABASE_MESSAGE


def test_a_sqlite_file_without_the_racer_table_is_refused(tmp_path: Path) -> None:
    other = tmp_path / "trusty-track.db"
    connection = sqlite3.connect(other)
    connection.execute("CREATE TABLE racers (id INTEGER PRIMARY KEY)")
    connection.commit()
    connection.close()

    with pytest.raises(RosterImportError) as refused:
        parse_gprm_database(other)
    assert str(refused.value) == NO_ROSTER_MESSAGE


def test_table_names_match_case_insensitively(tmp_path: Path) -> None:
    """The Access form writes `RegistrationInfo`; a hand export may not."""
    path = tmp_path / "lower.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript(
        "CREATE TABLE registrationinfo (RacerID INTEGER, CarNumber INTEGER, "
        "LastName TEXT, FirstName TEXT, PassedInspection INTEGER);"
        "INSERT INTO registrationinfo VALUES (1, 7, 'Rivera', 'Alex', -1);"
    )
    connection.commit()
    connection.close()

    roster = parse_gprm_database(path)
    assert roster.groups == ()
    assert roster.racers == (
        ImportedRacer(
            "Alex", "Rivera", car_number=7, passed_inspection=True, source_id="1"
        ),
    )


def test_file_kind_reads_the_header_not_the_extension(tmp_path: Path) -> None:
    disguised = tmp_path / "data.sqlite"
    disguised.write_bytes(b"\x00\x01\x00\x00Standard ACE DB\x00")
    assert sqlite_tables.file_kind(disguised) == "access"

    empty = tmp_path / "empty.mdb"
    empty.write_bytes(b"")
    assert sqlite_tables.file_kind(empty) == "unknown"


# --- the rule ---------------------------------------------------------------


def test_a_rank_named_for_its_class_gets_no_category() -> None:
    roster = gprm.roster_from_tables(
        Tables(Classes=ONE_CLASS, Ranks=ONE_RANK, RegistrationInfo=[])
    )
    assert roster.groups == (ImportedGroup("Wolves", division=None),)


def test_a_distinct_rank_is_categorised_by_its_class() -> None:
    roster = gprm.roster_from_tables(
        Tables(
            Classes=ONE_CLASS,
            Ranks=[{"rankid": 1, "rank": "Den 3", "classid": 1}],
            RegistrationInfo=[],
        )
    )
    assert roster.groups == (ImportedGroup("Den 3", division="Wolves"),)


def test_a_rank_name_shared_across_classes_is_prefixed_on_both() -> None:
    """Prefixing only the second holder would leave the first depending on
    which class the file happened to list first."""
    roster = gprm.roster_from_tables(
        Tables(
            Classes=[
                {"classid": 1, "class": "Wolves"},
                {"classid": 2, "class": "Bears"},
            ],
            Ranks=[
                {"rankid": 1, "rank": "Den 1", "classid": 1},
                {"rankid": 2, "rank": "den 1", "classid": 2},
            ],
            RegistrationInfo=[],
        )
    )
    assert [g.name for g in roster.groups] == ["Wolves Den 1", "Bears den 1"]


def test_a_class_with_no_ranks_is_a_group_of_its_own() -> None:
    roster = gprm.roster_from_tables(
        Tables(Classes=ONE_CLASS, Ranks=[], RegistrationInfo=[_racer(rankid=0)])
    )
    assert roster.groups == (ImportedGroup("Wolves"),)
    assert roster.racers[0].group == "Wolves"


def test_a_racer_in_no_known_group_is_named_in_a_problem() -> None:
    roster = gprm.roster_from_tables(
        Tables(Classes=[], Ranks=[], RegistrationInfo=[_racer(classid=5, rankid=9)])
    )
    assert roster.racers[0].group is None
    assert roster.problems == (
        ImportProblem(
            "Alex Rivera is in a group the file no longer describes — they will "
            "import with no group.",
            source_id="1",
        ),
    )


def test_a_racer_with_no_group_columns_at_all_is_quietly_ungrouped() -> None:
    """A minimal export with names and numbers only is not a broken file."""
    roster = gprm.roster_from_tables(
        Tables(RegistrationInfo=[{"racerid": 1, "firstname": "A", "lastname": "B"}])
    )
    assert roster.racers[0].group is None
    assert roster.problems == ()


def test_derbynets_aggregate_classes_are_not_groups() -> None:
    """A DerbyNet file (#661) builds a class out of other classes for a
    combined round; it holds no racers and must not become a group."""
    roster = gprm.roster_from_tables(
        Tables(
            Classes=[
                {"classid": 1, "class": "Wolves", "constituents": ""},
                {"classid": 2, "class": "Bears", "constituents": ""},
                {"classid": 3, "class": "Grand Finals", "constituents": "1,2"},
            ],
            Ranks=[],
            RegistrationInfo=[],
        )
    )
    assert [g.name for g in roster.groups] == ["Wolves", "Bears"]


@pytest.mark.parametrize(
    "value, expected",
    [
        (1, True),
        (-1, True),  # an Access BIT through ODBC
        (0, False),
        (None, False),
        ("True", True),
        ("false", False),
        ("yes", True),
        (b"\x01", True),
        (b"\x00", False),
        ("maybe", False),
    ],
)
def test_passed_inspection_reads_every_form_a_bit_takes(
    value: object, expected: bool
) -> None:
    roster = gprm.roster_from_tables(
        Tables(RegistrationInfo=[_racer(passedinspection=value)])
    )
    assert roster.racers[0].passed_inspection is expected


@pytest.mark.parametrize(
    "value, expected, complains",
    [
        (12, 12, False),
        ("12", 12, False),
        (12.0, 12, False),
        (0, None, False),  # not numbered yet
        (-3, None, False),
        (None, None, False),
        ("", None, False),
        ("12a", None, True),
        (12.5, None, True),
    ],
)
def test_car_number_reads_whole_numbers_and_says_when_it_cannot(
    value: object, expected: int | None, complains: bool
) -> None:
    roster = gprm.roster_from_tables(Tables(RegistrationInfo=[_racer(carnumber=value)]))
    assert roster.racers[0].car_number == expected
    assert any("not a whole number" in p.message for p in roster.problems) is complains


def test_a_weight_column_is_read_when_present_and_ignored_when_zero() -> None:
    roster = gprm.roster_from_tables(
        Tables(
            RegistrationInfo=[
                _racer(racerid=1, carnumber=1, carweight=4.98),
                _racer(racerid=2, carnumber=2, carweight=0),
                _racer(racerid=3, carnumber=3),
            ]
        )
    )
    assert [r.car_weight for r in roster.racers] == [4.98, None, None]


def test_racers_come_out_in_id_order_whatever_order_the_table_gives() -> None:
    roster = gprm.roster_from_tables(
        Tables(
            RegistrationInfo=[
                _racer(racerid=3, carnumber=3),
                _racer(racerid=1, carnumber=1),
                _racer(racerid=2, carnumber=2),
            ]
        )
    )
    assert [r.source_id for r in roster.racers] == ["1", "2", "3"]


def test_one_photo_is_a_singular_sentence() -> None:
    roster = gprm.roster_from_tables(
        Tables(RegistrationInfo=[_racer(imagefile="alex.jpg")])
    )
    assert roster.problems[-1].message.startswith("1 racer has photos")


def test_column_names_are_read_in_any_case() -> None:
    """The Access form is PascalCase; the SQLite form is lowercase."""
    roster = gprm.roster_from_tables(
        Tables(
            Classes=[{"ClassID": 1, "Class": "Wolves"}],
            Ranks=[{"RankID": 1, "Rank": "Den 2", "ClassID": 1}],
            RegistrationInfo=[
                {
                    "RacerID": 4,
                    "CarNumber": 44,
                    "CarName": "Zoom",
                    "LastName": "Rivera",
                    "FirstName": "Alex",
                    "ClassID": 1,
                    "RankID": 1,
                    "PassedInspection": -1,
                    "Exclude": 0,
                }
            ],
        )
    )
    assert roster.groups == (ImportedGroup("Den 2", division="Wolves"),)
    assert roster.racers == (
        ImportedRacer(
            "Alex",
            "Rivera",
            car_number=44,
            car_name="Zoom",
            passed_inspection=True,
            group="Den 2",
            source_id="4",
        ),
    )


# --- the shared vocabulary --------------------------------------------------


def test_duplicates_are_reported_against_the_second_holder() -> None:
    racers = [
        ImportedRacer("Alex", "Rivera", car_number=5, source_id="1"),
        ImportedRacer("Sam", "Okafor", car_number=5, source_id="2"),
        ImportedRacer("Pat", "Kim", car_number=None, source_id="3"),
        ImportedRacer("Lee", "Park", car_number=None, source_id="4"),
    ]
    assert duplicate_number_problems(racers) == [
        ImportProblem("Car number 5 is already used by Alex Rivera.", source_id="2")
    ]


def test_only_a_blocking_problem_stops_the_import() -> None:
    warned = ParsedRoster(problems=(ImportProblem("skipped one"),))
    assert warned.can_import
    blocked = ParsedRoster(problems=(ImportProblem("no racers", blocking=True),))
    assert not blocked.can_import


def test_the_domain_layer_imports_no_database_code() -> None:
    """The rule reads plain rows; the file is the service's business."""
    import backend.domain.gprm as rule

    assert "sqlite3" not in rule.__dict__
    assert "sqlalchemy" not in rule.__dict__
