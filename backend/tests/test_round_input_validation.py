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

from backend.db import crud, models, schemas


def _race(db, lane_count=3, racer_count=10, label="Bounds"):
    group = crud.create_group(db, schemas.GroupCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"{label} Track", lane_count=lane_count),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            group_id=group.id,
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
        advancementSource="PACK",
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
        advancementSource="PACK",
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
        advancementSource="PACK",
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
                    "generalRound": {"type": "PACK", "runsPerLane": 0},
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
                    "generalRound": {"type": "PACK", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "PACK",
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
                    "generalRound": {"type": "PACK", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Finals",
                            "source": "PACK",
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
