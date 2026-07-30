"""What `importRacers` reads out of a CSV.

The mutation takes a whole file and returns a count, so anything it fails to
read is invisible from the outside — which is why the column mapping UI (#60)
validates before sending, and why the fields it can send are pinned here.
"""

import pytest

from backend.db import crud, models, schemas

IMPORT = """
mutation Import($raceId: Int!, $csvData: String!) {
  importRacers(raceId: $raceId, csvData: $csvData)
}
"""


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
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
        "first_name,last_name,car_number,car_name,den,car_passed_inspection\n"
        "Alex,Rivera,101,Blue Streak,Wolves,yes\n",
    )

    assert count == 1
    racer = _racers(db, race.id)[0]
    assert (racer.first_name, racer.last_name) == ("Alex", "Rivera")
    assert racer.car_number == 101
    assert racer.car_name == "Blue Streak"
    assert racer.car_passed_inspection is True
    assert racer.den.name == "Wolves"


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


def test_a_non_numeric_car_number_is_left_blank(client, db, race):
    _import(client, race.id, "first_name,last_name,car_number\nAlex,Rivera,A12\n")

    assert _racers(db, race.id)[0].car_number is None


def test_dens_named_in_the_file_are_created_once(client, db, race):
    _import(
        client,
        race.id,
        "first_name,last_name,den\nAlex,Rivera,Wolves\nSam,Okafor,Wolves\n",
    )

    dens = db.query(models.Den).filter(models.Den.race_id == race.id).all()
    assert [den.name for den in dens] == ["Wolves"]
