"""What `importRacers` reads out of a CSV.

The mutation takes a whole file and returns a count, so anything it fails to
read is invisible from the outside — which is why the column mapping UI (#60)
validates before sending, and why the fields it can send are pinned here.
"""

import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from backend.api import schema
from backend.db import crud, models, schemas

IMPORT = """
mutation Import($raceId: Int!, $csvData: String!) {
  importRacers(raceId: $raceId, csvData: $csvData)
}
"""


@pytest.fixture
def race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            organization_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


def _import(client, race_id, csv_data):
    response = client.post(
        "/graphql",
        json={"query": IMPORT, "variables": {"raceId": race_id, "csvData": csv_data}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload.get("errors") is None, payload
    return payload["data"]["importRacers"]


def _racers(db, race_id):
    return (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id)
        .order_by(models.Racer.id)
        .all()
    )


def test_the_canonical_header_row_imports_every_field(client, db, race):
    """The header the mapping UI writes out. Every column has to land."""
    count = _import(
        client,
        race.id,
        "first_name,last_name,car_number,car_name,racing_group,car_passed_inspection\n"
        "Alex,Rivera,101,Blue Streak,Wolves,yes\n",
    )

    assert count == 1
    racer = _racers(db, race.id)[0]
    assert (racer.first_name, racer.last_name) == ("Alex", "Rivera")
    assert racer.car_number == 101
    assert racer.car_name == "Blue Streak"
    assert racer.car_passed_inspection is True
    assert racer.racing_group.name == "Wolves"


def test_car_name_and_inspection_used_to_be_dropped(client, db, race):
    """Both columns were parsed and then never read, so an operator who filled
    them in got racers with neither."""
    _import(
        client,
        race.id,
        "first_name,last_name,car_name,car_passed_inspection\nSam,Okafor,Thunderbolt,no\n",
    )

    racer = _racers(db, race.id)[0]
    assert racer.car_name == "Thunderbolt"
    assert racer.car_passed_inspection is False


def test_an_absent_inspection_column_leaves_racers_unchecked(client, db, race):
    """Not stated is not the same as passed — a racer imported without the
    column must still go through check-in."""
    _import(client, race.id, "first_name,last_name\nAlex,Rivera\n")

    assert _racers(db, race.id)[0].car_passed_inspection is False


def test_a_row_with_no_name_is_skipped_and_not_counted(client, db, race):
    """The behaviour the UI now warns about before sending: the row vanishes and
    the count is the only evidence."""
    count = _import(
        client, race.id, "first_name,last_name\nAlex,Rivera\n,Okafor\nSam,\n"
    )

    assert count == 1
    assert len(_racers(db, race.id)) == 1


def test_a_leading_utf8_bom_does_not_hide_every_row(client, db, race):
    """Excel writes a BOM on every "CSV UTF-8" save. Left attached to the
    first header it never matched `first_name`, so `get_val` returned None
    for every row and the import silently returned 0."""
    count = _import(
        client,
        race.id,
        "﻿first_name,last_name\nAlex,Rivera\n",
    )

    assert count == 1
    assert _racers(db, race.id)[0].first_name == "Alex"


def test_a_non_numeric_car_number_is_left_blank(client, db, race):
    _import(client, race.id, "first_name,last_name,car_number\nAlex,Rivera,A12\n")

    assert _racers(db, race.id)[0].car_number is None


def test_dens_named_in_the_file_are_created_once(client, db, race):
    _import(
        client,
        race.id,
        "first_name,last_name,racing_group\nAlex,Rivera,Wolves\nSam,Okafor,Wolves\n",
    )

    racing_groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert [racing_group.name for racing_group in racing_groups] == ["Wolves"]


def test_import_racers_exceeding_csv_length_is_refused(
    client: pytest.FixtureRequest, race: models.Race, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An oversized CSV payload is rejected with a GraphQL error (#744)."""
    monkeypatch.setattr(schema, "MAX_UPLOAD_BYTES", 100)
    huge_csv = "first_name,last_name\n" * 10
    response = client.post(  # type: ignore[union-attr]
        "/graphql",
        json={
            "query": IMPORT,
            "variables": {"raceId": race.id, "csvData": huge_csv},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "CSV data is larger than" in payload["errors"][0]["message"]


def test_import_racers_exceeding_utf8_bytes_is_refused(
    client: pytest.FixtureRequest, race: models.Race, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A CSV payload whose multi-byte UTF-8 encoding exceeds MAX_UPLOAD_BYTES
    is rejected (#744).
    """
    monkeypatch.setattr(schema, "MAX_UPLOAD_BYTES", 50)
    # 10 emojis are 40+ bytes in UTF-8, pushing encoded bytes over 50.
    multibyte_csv = "first_name,last_name\n" + ("🏎️" * 10)
    assert len(multibyte_csv) < 50
    assert len(multibyte_csv.encode("utf-8")) > 50

    response = client.post(  # type: ignore[union-attr]
        "/graphql",
        json={
            "query": IMPORT,
            "variables": {"raceId": race.id, "csvData": multibyte_csv},
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "CSV data is larger than" in payload["errors"][0]["message"]


def test_whitespace_padded_car_number_is_parsed(
    client: TestClient, db: Session, race: models.Race
) -> None:
    """Car number cells padded with spaces are stripped before parsing (#864)."""
    count = _import(
        client,
        race.id,
        "first_name,last_name,car_number\nAlex,Rivera,  12  \n",
    )

    assert count == 1
    racer = _racers(db, race.id)[0]
    assert racer.car_number == 12


def test_failed_import_leaves_no_racers_behind(
    client: TestClient,
    db: Session,
    race: models.Race,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When an import fails midway, the transaction rolls back cleanly (#864)."""
    original_create_racer = crud.create_racer
    calls = 0

    def fail_on_second(
        db: Session, racer: schemas.RacerCreate, **kwargs: object
    ) -> models.Racer:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Midway failure during racer creation")
        return original_create_racer(db, racer, **kwargs)

    monkeypatch.setattr(crud, "create_racer", fail_on_second)

    csv_data = (
        "first_name,last_name,car_number,racing_group\n"
        "Alex,Rivera,101,Wolves\n"
        "Sam,Okafor,102,Wolves\n"
    )

    response = client.post(
        "/graphql",
        json={"query": IMPORT, "variables": {"raceId": race.id, "csvData": csv_data}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "Midway failure" in payload["errors"][0]["message"]

    # Verify atomic rollback: no racers or racing groups should remain
    assert _racers(db, race.id) == []
    racing_groups = (
        db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race.id).all()
    )
    assert racing_groups == []


# --------------------------------------------------------------------------- #
# #1021: importing the same roster a second time must refuse, not duplicate    #
# --------------------------------------------------------------------------- #


def test_importing_the_same_csv_twice_refuses_the_second_call(
    client: TestClient, db: Session, race: models.Race
) -> None:
    """9 racers becoming 18 was the symptom -- two rows, imported twice,
    must leave the roster holding exactly the first two."""
    csv_data = "first_name,last_name,car_number\nAlex,Rivera,101\nSam,Okafor,102\n"
    count = _import(client, race.id, csv_data)
    assert count == 2

    response = client.post(
        "/graphql",
        json={"query": IMPORT, "variables": {"raceId": race.id, "csvData": csv_data}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    message = payload["errors"][0]["message"]
    assert "Alex Rivera" in message
    assert "already on the roster" in message

    db.expire_all()
    racers = _racers(db, race.id)
    assert len(racers) == 2
    assert {r.first_name for r in racers} == {"Alex", "Sam"}


def test_a_csv_naming_the_same_child_twice_is_refused(
    client: TestClient, db: Session, race: models.Race
) -> None:
    """A within-file duplicate, caught before anything is written -- the
    same rule as the roster check above, applied to two rows in one file."""
    csv_data = "first_name,last_name,car_number\nAlex,Rivera,101\nalex,  rivera ,102\n"
    response = client.post(
        "/graphql",
        json={"query": IMPORT, "variables": {"raceId": race.id, "csvData": csv_data}},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "Alex Rivera" in payload["errors"][0]["message"]

    assert _racers(db, race.id) == []


def test_a_partial_name_match_does_not_block_an_unrelated_racer(
    client: TestClient, db: Session, race: models.Race
) -> None:
    """The refusal is name-scoped, not roster-wide -- importing a new,
    distinctly-named racer must succeed even though somebody else is
    already on the roster."""
    crud.create_racer(
        db,
        schemas.RacerCreate(first_name="Alex", last_name="Rivera", race_id=race.id),
    )
    count = _import(client, race.id, "first_name,last_name\nSam,Okafor\n")
    assert count == 1
    assert {r.first_name for r in _racers(db, race.id)} == {"Alex", "Sam"}
