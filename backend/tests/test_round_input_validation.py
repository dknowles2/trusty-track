"""Bounds on `advancement_num_racers` and `runs_per_lane` (#321).

Neither was validated at the GraphQL boundary, so the API could be asked to
build a championship round nothing on the UI would ever request:

- A negative `advancement_num_racers` is Python's "all but the last N" when
  read back as `ordered[:num_racers]` (`domain/advancement.py`), so
  `num_racers=-2` over ten racers silently advances racers 1-8 rather than
  refusing. `field_size` returns the same negative number, so the round's
  heats and its advancing field cannot agree either.
- `runs_per_lane=0` (or a negative) schedules zero heats. The round is then
  stuck `NOT_READY` with no controls and no rebuild path out — the same trap
  as a short field, but self-inflicted and with nothing to fix it.

Both were already refused for `elimination_losses` and `balanced_phases`;
this closes the same gap for the other two.
"""

import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from backend.db import crud, models, schemas


def _race(db, lane_count=3, racer_count=10, label="Bounds"):
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} Pack")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"{label} Track", lane_count=lane_count),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    for i in range(racer_count):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(i),
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return race


def _rounds(db, race_id):
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def _create_round(client, race_id, **fields):
    return client.post(
        "/graphql",
        json={
            "query": """
            mutation Add($raceId: Int!, $round: RoundCreateInput!) {
                createRound(raceId: $raceId, roundData: $round) { id }
            }
            """,
            "variables": {"raceId": race_id, "round": fields},
        },
    )


def test_a_negative_advancement_num_racers_is_refused(db, client):
    race = _race(db, label="NegAdv")
    _create_round(client, race.id, name="All Pack", runsPerLane=1)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="ALL",
        advancementNumRacers=-2,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert "advancement_num_racers" in body["errors"][0]["message"]
    # No half-made championship round left behind.
    assert len(_rounds(db, race.id)) == 1


def test_a_zero_advancement_num_racers_is_refused(db, client):
    race = _race(db, label="ZeroAdv")
    _create_round(client, race.id, name="All Pack", runsPerLane=1)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="ALL",
        advancementNumRacers=0,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert len(_rounds(db, race.id)) == 1


def test_a_zero_runs_per_lane_is_refused_for_a_general_round(db, client):
    race = _race(db, label="ZeroRunsGeneral")

    response = _create_round(client, race.id, name="All Pack", runsPerLane=0)

    body = response.json()
    assert "errors" in body, body
    assert "run per lane" in body["errors"][0]["message"]
    # No round left behind with zero heats and no way to rebuild it.
    assert _rounds(db, race.id) == []


def test_a_negative_runs_per_lane_is_refused_for_a_championship_round(db, client):
    race = _race(db, label="NegRunsChamp")
    _create_round(client, race.id, name="All Pack", runsPerLane=1)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="ALL",
        advancementNumRacers=3,
        runsPerLane=-1,
    )

    body = response.json()
    assert "errors" in body, body
    assert len(_rounds(db, race.id)) == 1


def test_the_wizard_refuses_a_zero_runs_per_lane_on_the_general_round(db, client):
    race = _race(db, label="WizardZeroGeneral")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 0},
                    "championshipRounds": [],
                },
            },
        },
    )

    body = response.json()
    assert "errors" in body, body
    assert _rounds(db, race.id) == []


def test_the_wizard_refuses_a_negative_num_top_racers(db, client):
    race = _race(db, label="WizardNegChamp")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "ALL",
                            "numTopRacers": -3,
                            "runsPerLane": 1,
                        }
                    ],
                },
            },
        },
    )

    body = response.json()
    assert "errors" in body, body
    # Validated before anything is created, so the general round it would
    # otherwise have committed is not left behind either.
    assert _rounds(db, race.id) == []


def test_the_wizard_refuses_a_zero_runs_per_lane_on_a_championship_round(db, client):
    race = _race(db, label="WizardZeroChamp")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "ALL",
                            "numTopRacers": 3,
                            "runsPerLane": 0,
                        }
                    ],
                },
            },
        },
    )

    body = response.json()
    assert "errors" in body, body
    assert _rounds(db, race.id) == []


def test_create_round_refuses_elimination_on_track_with_fewer_than_two_usable_lanes(
    db, client
):
    race = _race(db, lane_count=1, label="OneLaneElim")

    response = _create_round(
        client,
        race.id,
        name="Elimination",
        schedulingStrategy="ELIMINATION",
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert (
        "An elimination or balanced round requires at least two usable lanes."
        in body["errors"][0]["message"]
    )
    assert _rounds(db, race.id) == []


def test_create_round_refuses_balanced_on_track_with_fewer_than_two_usable_lanes(
    db, client
):
    race = _race(db, lane_count=1, label="OneLaneBal")

    response = _create_round(
        client,
        race.id,
        name="Balanced",
        schedulingStrategy="BALANCED",
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert (
        "An elimination or balanced round requires at least two usable lanes."
        in body["errors"][0]["message"]
    )
    assert _rounds(db, race.id) == []


def test_create_round_wizard_refuses_elimination_on_narrow_track(db, client):
    race = _race(db, lane_count=1, label="OneLaneWizardElim")
    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "ELIMINATION",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" in body, body
    assert (
        "An elimination or balanced round requires at least two usable lanes."
        in body["errors"][0]["message"]
    )
    assert _rounds(db, race.id) == []


def test_create_round_wizard_refuses_balanced_on_narrow_track(db, client):
    race = _race(db, lane_count=1, label="OneLaneWizardBal")
    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "BALANCED",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" in body, body
    assert (
        "An elimination or balanced round requires at least two usable lanes."
        in body["errors"][0]["message"]
    )
    assert _rounds(db, race.id) == []


def test_create_round_refuses_advancement_source_naming_nonexistent_round(
    db: Session, client: TestClient
) -> None:
    """A championship round cannot advance from a round ID that does not exist."""
    race = _race(db, label="NonexistentRoundAdv")
    _create_round(client, race.id, name="All Pack", runsPerLane=1)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="ROUND:999",
        advancementNumRacers=3,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert "Invalid advancement source" in body["errors"][0]["message"]
    # No half-made round left behind.
    assert len(_rounds(db, race.id)) == 1


def test_create_round_refuses_bogus_advancement_source(
    db: Session, client: TestClient
) -> None:
    """A championship round refuses an unrecognised advancement source."""
    race = _race(db, label="BogusAdv")
    _create_round(client, race.id, name="All Pack", runsPerLane=1)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="BOGUS",
        advancementNumRacers=3,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert "Invalid advancement source" in body["errors"][0]["message"]
    assert len(_rounds(db, race.id)) == 1


def test_create_round_refuses_advancement_source_from_different_race(
    db: Session, client: TestClient
) -> None:
    """A championship round cannot advance from another race's round."""
    race1 = _race(db, label="OtherRace1")
    _create_round(client, race1.id, name="Pack 1", runsPerLane=1)
    r1 = _rounds(db, race1.id)[0]

    race2 = _race(db, label="OtherRace2")
    _create_round(client, race2.id, name="Pack 2", runsPerLane=1)

    response = _create_round(
        client,
        race2.id,
        name="Finals",
        advancementSource=f"ROUND:{r1.id}",
        advancementNumRacers=3,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert "Invalid advancement source" in body["errors"][0]["message"]
    assert len(_rounds(db, race2.id)) == 1


def test_crud_create_round_refuses_invalid_advancement_sources(
    db: Session,
) -> None:
    """`crud.create_round` refuses nonexistent, bogus, or foreign-race sources."""
    race1 = _race(db, label="CrudAdv1")
    r1 = crud.create_round(db, race_id=race1.id, round_number=1, name="Prelim 1")

    race2 = _race(db, label="CrudAdv2")

    with pytest.raises(ValueError, match="Invalid advancement source"):
        crud.create_round(
            db,
            race_id=race1.id,
            round_number=2,
            advancement_source="ROUND:999",
            advancement_num_racers=3,
        )

    with pytest.raises(ValueError, match="Invalid advancement source"):
        crud.create_round(
            db,
            race_id=race1.id,
            round_number=2,
            advancement_source="BOGUS",
            advancement_num_racers=3,
        )

    with pytest.raises(ValueError, match="Invalid advancement source"):
        crud.create_round(
            db,
            race_id=race2.id,
            round_number=1,
            advancement_source=f"ROUND:{r1.id}",
            advancement_num_racers=3,
        )


def test_the_wizard_refuses_bogus_advancement_source(
    db: Session, client: TestClient
) -> None:
    """The wizard refuses a bogus championship source before creating rounds."""
    race = _race(db, label="WizardBogusChamp")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "BOGUS",
                            "numTopRacers": 3,
                            "runsPerLane": 1,
                        }
                    ],
                },
            },
        },
    )

    body = response.json()
    assert "errors" in body, body
    assert "Invalid advancement source" in body["errors"][0]["message"]
    assert _rounds(db, race.id) == []


def test_the_wizard_refuses_advancement_source_naming_nonexistent_round(
    db: Session, client: TestClient
) -> None:
    """The wizard refuses a nonexistent round source before creating any rounds."""
    race = _race(db, label="WizardNonexistentChamp")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "ROUND:999",
                            "numTopRacers": 3,
                            "runsPerLane": 1,
                        }
                    ],
                },
            },
        },
    )

    body = response.json()
    assert "errors" in body, body
    assert "Invalid advancement source" in body["errors"][0]["message"]
    assert _rounds(db, race.id) == []
