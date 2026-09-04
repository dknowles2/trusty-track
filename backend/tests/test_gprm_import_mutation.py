"""What `previewGprmImport` and `confirmGprmImport` do (#618, stage 3).

The parser (`domain/gprm.py`, `services/importers/gprm.py`) is pinned in
`test_gprm_import.py`; this file is about the mutation shape around it —
that a preview writes nothing, that a confirm re-parses the upload rather
than trusting anything handed back from the client, that a collision with
the *existing* roster is caught (the in-file rule is the parser's own; this
is the database half `domain.roster_import.duplicate_number_problems`'s
docstring reserves for stage 3), and that late-racer admission and the
role/lock/demo classification all reach it exactly the way `importRacers`
already does.
"""

import base64
import sqlite3
from pathlib import Path

import pytest

from backend.db import crud, models, schemas

FIXTURES = Path(__file__).parent / "roster_imports"

PREVIEW = """
mutation Preview($raceId: Int!, $fileData: String!) {
  previewGprmImport(raceId: $raceId, fileData: $fileData) {
    canImport
    groups { name division }
    racers { firstName lastName carNumber carName passedInspection group sourceId }
    problems { message blocking sourceId }
  }
}
"""

CONFIRM = """
mutation Confirm($raceId: Int!, $fileData: String!) {
  confirmGprmImport(raceId: $raceId, fileData: $fileData)
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
    path = tmp_path / "GPRM Data.sqlite"
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
    preview = payload["data"]["previewGprmImport"]
    assert preview["canImport"] is True
    assert [r["firstName"] for r in preview["racers"]] == ["Alex"]

    db.expire_all()
    assert db.query(models.Racer).filter(models.Racer.race_id == race.id).count() == 0


def test_confirm_writes_the_racer_and_returns_the_count(client, db, race, tmp_path):
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)
    response = _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})
    payload = response.json()
    assert payload.get("errors") is None, payload
    assert payload["data"]["confirmGprmImport"] == 1

    db.expire_all()
    racer = db.query(models.Racer).filter(models.Racer.race_id == race.id).one()
    assert (racer.first_name, racer.last_name) == ("Alex", "Rivera")
    assert racer.car_number == 101
    assert racer.car_name == "Blue Streak"
    assert racer.car_passed_inspection is True


def test_confirm_creates_a_group_per_rank_categorised_by_class(
    client, db, race, tmp_path
):
    script = """
    CREATE TABLE Classes (ClassID INTEGER, Class TEXT);
    CREATE TABLE Ranks (RankID INTEGER, Rank TEXT, ClassID INTEGER);
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT,
        ClassID INTEGER, RankID INTEGER, PassedInspection INTEGER
    );
    INSERT INTO Classes VALUES (1, 'Wolves');
    INSERT INTO Ranks VALUES (1, 'Den 3', 1);
    INSERT INTO RegistrationInfo VALUES (1, 1, 'Rivera', 'Alex', 1, 1, 0);
    INSERT INTO RegistrationInfo VALUES (2, 2, 'Okafor', 'Sam', 1, 1, 0);
    """
    raw = _sqlite_bytes(tmp_path, script)
    _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})

    db.expire_all()
    groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert [g.name for g in groups] == ["Den 3"]
    assert groups[0].division == "Wolves"
    racers = db.query(models.Racer).filter(models.Racer.race_id == race.id).all()
    assert {r.racing_group_id for r in racers} == {groups[0].id}


def test_an_existing_group_by_name_is_reused_not_duplicated(client, db, race, tmp_path):
    existing = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves", color="#ff0000"), race.id
    )
    script = """
    CREATE TABLE Classes (ClassID INTEGER, Class TEXT);
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT,
        ClassID INTEGER
    );
    INSERT INTO Classes VALUES (1, 'Wolves');
    INSERT INTO RegistrationInfo VALUES (1, 1, 'Rivera', 'Alex', 1);
    """
    raw = _sqlite_bytes(tmp_path, script)
    _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})

    db.expire_all()
    groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert len(groups) == 1
    assert groups[0].id == existing.id
    assert groups[0].color == "#ff0000"  # untouched -- reused, not overwritten
    racer = db.query(models.Racer).filter(models.Racer.race_id == race.id).one()
    assert racer.racing_group_id == existing.id


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
    preview = response.json()["data"]["previewGprmImport"]

    assert preview["canImport"] is True  # a warning, never a block
    assert any(
        "101" in p["message"]
        and "Already Here" in p["message"]
        and "already on the roster" in p["message"]
        for p in preview["problems"]
    )


def test_the_existing_roster_rule_only_checks_the_files_first_holder(
    client, db, race, tmp_path
):
    """Two racers in the file share a number, and the number is also already
    on the roster. The parser's own in-file rule reports the collision once,
    against the *second* file holder; the existing-roster rule reports its
    own collision once, against the *first* -- not once per file holder,
    which would say the same thing about the number twice."""
    crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Already", last_name="Here", car_number=5, race_id=race.id
        ),
    )
    script = """
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT
    );
    INSERT INTO RegistrationInfo VALUES (1, 5, 'Rivera', 'Alex');
    INSERT INTO RegistrationInfo VALUES (2, 5, 'Okafor', 'Sam');
    """
    raw = _sqlite_bytes(tmp_path, script)
    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    problems = response.json()["data"]["previewGprmImport"]["problems"]

    existing_roster_hits = [
        p for p in problems if "already on the roster" in p["message"]
    ]
    assert len(existing_roster_hits) == 1
    assert existing_roster_hits[0]["sourceId"] == "1"  # the file's first holder

    in_file_hits = [
        p
        for p in problems
        if p["message"] == "Car number 5 is already used by Alex Rivera."
    ]
    assert len(in_file_hits) == 1
    assert in_file_hits[0]["sourceId"] == "2"  # the file's second holder


def test_a_number_only_used_once_is_no_problem(client, race, tmp_path):
    raw = _sqlite_bytes(tmp_path, ONE_RACER_SCRIPT)
    response = _post(client, PREVIEW, {"raceId": race.id, "fileData": _data_url(raw)})
    problems = response.json()["data"]["previewGprmImport"]["problems"]
    assert problems == []


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


def test_confirm_leaves_an_uninspected_import_unscheduled(client, db, race, tmp_path):
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
    before = len(crud.get_heats(db, race.id, round_id=round_obj.id))

    script = """
    CREATE TABLE RegistrationInfo (
        RacerID INTEGER, CarNumber INTEGER, LastName TEXT, FirstName TEXT,
        PassedInspection INTEGER
    );
    INSERT INTO RegistrationInfo VALUES (1, 5, 'Rivera', 'Alex', 0);
    """
    raw = _sqlite_bytes(tmp_path, script)
    _post(client, CONFIRM, {"raceId": race.id, "fileData": _data_url(raw)})

    db.expire_all()
    assert len(crud.get_heats(db, race.id, round_id=round_obj.id)) == before


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
    assert "not a GrandPrix Race Manager database" in payload["errors"][0]["message"]


def test_an_access_database_names_the_fix(client, race):
    """The refusal a real pack with a pre-2018 GPRM file will actually see."""
    mdb_header = b"\x00\x01\x00\x00Standard Jet DB\x00" + b"\x00" * 64
    response = client.post(
        "/graphql",
        json={
            "query": PREVIEW,
            "variables": {"raceId": race.id, "fileData": _data_url(mdb_header)},
        },
    )
    payload = response.json()
    assert payload.get("errors")
    assert "saves as SQLite" in payload["errors"][0]["message"]


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
    assert (
        "larger than GrandPrix Race Manager writes" in payload["errors"][0]["message"]
    )


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
    """Preview writes nothing, so it stays reachable -- the same "everything
    not named below" default `race_lock.py`'s own docstring describes."""
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
    """The database `test_gprm_import.py` parses, actually written here."""
    path = tmp_path / "GPRM Data.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript((FIXTURES / "gprm-v18.sql").read_text())
    connection.commit()
    connection.close()

    response = _post(
        client, CONFIRM, {"raceId": race.id, "fileData": _data_url(path.read_bytes())}
    )
    payload = response.json()
    assert payload.get("errors") is None, payload
    # 10 rows in the fixture; racer #7 has no name and is skipped (#618's
    # parser test pins this exact set of source ids).
    assert payload["data"]["confirmGprmImport"] == 9

    db.expire_all()
    racers = db.query(models.Racer).filter(models.Racer.race_id == race.id).all()
    assert len(racers) == 9
    groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert {g.name for g in groups} == {
        "Bears",
        "Bears Den 1",
        "Wolves",
        "Wolves Den 1",
        "Den 4",
        "Den 5",
        "Siblings",
        "Webelos",
    }
