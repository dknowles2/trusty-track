"""What `previewDerbynetImport` and `confirmDerbynetImport` do (#661).

The parser (`domain/derbynet.py`, `services/importers/derbynet.py`) is
pinned in `test_derbynet_import.py`; this file is the DerbyNet twin of
`test_gprm_import_mutation.py` — the mutation shape around it, which is
identical to GPRM's for every rule that lives in `crud.write_imported_roster`
and `domain.roster_import` rather than in either parser. Kept as its own
file, mirroring the sibling-mutation choice in `api/schema.py`, rather than
parametrising the GPRM file over both mutations: a change to one importer's
own behaviour must not silently start asserting something about the other's.
"""

import base64
import sqlite3
from pathlib import Path

import pytest

from backend.db import crud, models, schemas

FIXTURES = Path(__file__).parent / "roster_imports"

PREVIEW = """
mutation Preview($raceId: Int!, $fileData: String!) {
  previewDerbynetImport(raceId: $raceId, fileData: $fileData) {
    canImport
    groups { name division }
    racers { firstName lastName carNumber carName passedInspection group sourceId }
    problems { message blocking sourceId }
  }
}
"""

CONFIRM = """
mutation Confirm($raceId: Int!, $fileData: String!) {
  confirmDerbynetImport(raceId: $raceId, fileData: $fileData)
}
"""

ONE_RACER_SCRIPT = """
CREATE TABLE RegistrationInfo (
    RacerID INTEGER, CarNumber INTEGER, CarName TEXT,
    LastName TEXT, FirstName TEXT, ClassID INTEGER, RankID INTEGER,
    PassedInspection INTEGER
);
INSERT INTO RegistrationInfo VALUES
    (1, 101, 'Blue Streak', 'Rivera', 'Alex', NULL, NULL, -1);
"""


def _data_url(raw: bytes) -> str:
    return "data:application/octet-stream;base64," + base64.b64encode(raw).decode()


def _sqlite_bytes(tmp_path: Path, script: str) -> bytes:
    path = tmp_path / "derbynet.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript(script)
    connection.commit()
    connection.close()
    return path.read_bytes()


def _post(client, query, variables):
    return client.post("/graphql", json={"query": query, "variables": variables})


@pytest.fixture
def race(db):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            organization_id=org.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


# --------------------------------------------------------------------------- #
# Preview writes nothing; confirm writes exactly what was previewed            #
# --------------------------------------------------------------------------- #


def test_preview_writes_nothing(client, db, race, tmp_path):
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)
    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    payload = response.json()
    assert payload.get("errors") is None, payload
    preview = payload["data"]["previewDerbynetImport"]
    assert preview["canImport"] is True
    assert [r["firstName"] for r in preview["racers"]] == ["Alex"]

    db.expire_all()
    assert db.query(models.Racer).filter(models.Racer.race_id == race.id).count() == 0


def test_confirm_writes_the_racer_and_returns_the_count(client, db, race, tmp_path):
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)
    response = _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})
    payload = response.json()
    assert payload.get("errors") is None, payload
    assert payload["data"]["confirmDerbynetImport"] == 1

    db.expire_all()
    racer = db.query(models.Racer).filter(models.Racer.race_id == race.id).one()
    assert (racer.first_name, racer.last_name) == ("Alex", "Rivera")
    assert racer.car_number == 101
    assert racer.car_passed_inspection is True


def test_confirm_reads_a_partitions_table_the_gprm_path_never_sees(
    client, db, race, tmp_path
):
    """The one thing `domain/derbynet.py` adds over `domain/gprm.py` --
    covered end to end through the mutation, not just the parser."""
    script = """
    CREATE TABLE Classes (ClassID INTEGER, Class TEXT);
    CREATE TABLE Ranks (RankID INTEGER, Rank TEXT, ClassID INTEGER);
    CREATE TABLE Partitions (PartitionID INTEGER, Name TEXT, RankID INTEGER);
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT,
        ClassID INTEGER, RankID INTEGER
    );
    INSERT INTO Classes VALUES (1, 'Wolves');
    INSERT INTO Ranks VALUES (1, 'stale-name', 1);
    INSERT INTO Partitions VALUES (1, 'Wolves', 1);
    INSERT INTO RegistrationInfo VALUES (1, 1, 'Rivera', 'Alex', 1, 1);
    """
    raw = _sqlite_bytes(tmp_path, script)
    _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})

    db.expire_all()
    groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert [g.name for g in groups] == ["Wolves"]
    assert groups[0].division is None


def test_the_photo_warning_reaching_the_operator_names_derbynet(client, race, tmp_path):
    script = """
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT,
        ImageFile TEXT
    );
    INSERT INTO RegistrationInfo VALUES (1, 1, 'Rivera', 'Alex', 'alex.jpg');
    """
    raw = _sqlite_bytes(tmp_path, script)
    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    problems = response.json()["data"]["previewDerbynetImport"]["problems"]
    assert any("photos in DerbyNet" in p["message"] for p in problems)


# --------------------------------------------------------------------------- #
# Duplicate prevention against the roster already in the race                  #
# --------------------------------------------------------------------------- #


def test_a_duplicate_against_the_existing_roster_is_a_preview_warning(
    client, db, race, tmp_path
):
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Already", last_name="Here", car_number=101, race_id=race.id
        ),
    )
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)
    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    preview = response.json()["data"]["previewDerbynetImport"]

    assert preview["canImport"] is True  # a warning, never a block
    assert any(
        "101" in p["message"]
        and "Already Here" in p["message"]
        and "already on the roster" in p["message"]
        for p in preview["problems"]
    )


# --------------------------------------------------------------------------- #
# Late-racer admission, once for the batch (#343's fix, applied here too)      #
# --------------------------------------------------------------------------- #


def test_confirm_admits_a_checked_in_racer(client, db, race, tmp_path):
    round_obj = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim"
    )
    seed = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Seed",
            last_name="Racer",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )
    crud.generate_heats_for_round(db, round_obj.id, racer_ids=[seed.id])

    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)  # PassedInspection = -1 (true)
    _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})

    db.expire_all()
    imported = (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race.id, models.Racer.car_number == 101)
        .one()
    )
    scheduled = {
        lane.racer_id
        for lane in db.query(models.HeatLane)
        .join(models.Heat, models.HeatLane.heat_id == models.Heat.id)
        .filter(models.Heat.round_id == round_obj.id)
        .all()
    }
    assert imported.id in scheduled


# --------------------------------------------------------------------------- #
# Failure sentences reaching the operator                                      #
# --------------------------------------------------------------------------- #


def test_an_unreadable_file_returns_the_parsers_own_sentence(client, race):
    response = client.post(
        "/graphql",
        json={
            "query": PREVIEW,
            "variables": {
                "raceId": race.id,
                "fileData": _data_url(b"not a database at all"),
            },
        },
    )
    payload = response.json()
    assert payload.get("errors")
    assert "not a DerbyNet database" in payload["errors"][0]["message"]


def test_a_missing_race_is_refused(client):
    response = client.post(
        "/graphql",
        json={
            "query": PREVIEW,
            "variables": {"raceId": 999999, "fileData": _data_url(b"x")},
        },
    )
    payload = response.json()
    assert payload.get("errors")
    assert "Race not found" in payload["errors"][0]["message"]


def test_a_file_larger_than_the_cap_is_refused(client, race):
    huge = base64.b64encode(b"0" * (65 * 1024 * 1024)).decode()
    response = client.post(
        "/graphql",
        json={
            "query": PREVIEW,
            "variables": {
                "raceId": race.id,
                "fileData": "data:application/octet-stream;base64," + huge,
            },
        },
    )
    payload = response.json()
    assert payload.get("errors")
    assert "larger than DerbyNet writes" in payload["errors"][0]["message"]


# --------------------------------------------------------------------------- #
# A locked race: preview stays reachable, confirm is refused                   #
# --------------------------------------------------------------------------- #


def test_confirm_is_refused_on_a_locked_race(client, db, race, tmp_path):
    race.is_locked = True
    db.commit()
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)

    response = _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})
    payload = response.json()
    assert payload.get("errors")

    db.expire_all()
    assert db.query(models.Racer).filter(models.Racer.race_id == race.id).count() == 0


def test_preview_still_works_on_a_locked_race(client, db, race, tmp_path):
    race.is_locked = True
    db.commit()
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)

    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    payload = response.json()
    assert payload.get("errors") is None, payload


# --------------------------------------------------------------------------- #
# The real fixture, end to end                                                 #
# --------------------------------------------------------------------------- #


def test_the_real_fixture_round_trips_through_confirm(client, db, race, tmp_path):
    """The database `test_derbynet_import.py` parses, actually written here."""
    path = tmp_path / "derbynet.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript((FIXTURES / "derbynet.sql").read_text())
    connection.commit()
    connection.close()

    response = _post(
        client, CONFIRM, {"raceId": race.id, "fileData": _data_url(path.read_bytes())}
    )
    payload = response.json()
    assert payload.get("errors") is None, payload
    assert payload["data"]["confirmDerbynetImport"] == 5

    db.expire_all()
    racers = db.query(models.Racer).filter(models.Racer.race_id == race.id).all()
    assert len(racers) == 5
    groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert {g.name for g in groups} == {"Wolves", "Bears", "Den 4", "Den 5", "Siblings"}
    excluded = next(r for r in racers if r.first_name == "Pat")
    assert excluded.excluded_from_standings is True
