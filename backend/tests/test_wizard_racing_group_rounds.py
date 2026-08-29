"""The wizard's per-racing-group general rounds — an entire branch nothing exercised.

Found in a coverage audit: `createRoundWizard` with a general round of type
``EACH_GROUP`` builds one round *per racing group*, and no test had ever
taken that branch — so its numbering, its racing-group scoping, its
empty-racing-group rule and its share of the rollback fix (#249) were all
held by nothing.
"""

from backend.db import crud, models, schemas


def _race(db, name, racing_group_racers):
    """A race with one racing group per entry in ``racing_group_racers``."""
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack for {name}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    race = crud.create_race(
        db, schemas.RaceCreate(organization_id=group.id, name=name, track_id=track.id)
    )
    car = 1
    for d, count in enumerate(racing_group_racers):
        racing_group = crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(name=f"RacingGroup {d + 1}", color="#123456"),
            race.id,
        )
        for n in range(count):
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    race_id=race.id,
                    racing_group_id=racing_group.id,
                    first_name=f"Racer{d}-{n}",
                    last_name="Wizard",
                    car_number=car,
                    car_passed_inspection=True,
                ),
            )
            car += 1
    return race


WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) { id roundNumber name }
}
"""


def _den_wizard(client, race_id, championship_rounds=()):
    return client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race_id,
                "config": {
                    "generalRound": {"type": "EACH_GROUP", "runsPerLane": 1},
                    "championshipRounds": list(championship_rounds),
                },
            },
        },
    ).json()


def test_one_round_per_den_named_after_it(db, client):
    race = _race(db, "Per-RacingGroup Derby", [3, 3])

    body = _den_wizard(client, race.id)
    assert "errors" not in body, body

    rounds = body["data"]["createRoundWizard"]
    assert [r["name"] for r in rounds] == ["RacingGroup 1", "RacingGroup 2"]
    assert [r["roundNumber"] for r in rounds] == [1, 2]

    # Each round's heats hold only that racing group's racers.
    db.expire_all()
    for r in rounds:
        round_obj = db.get(models.Round, r["id"])
        racing_group_racer_ids = {
            racer.id
            for racer in db.query(models.Racer)
            .filter(models.Racer.racing_group_id == round_obj.racing_group_id)
            .all()
        }
        for heat_lanes in crud.lanes_for_heats(db, round_obj.heats):
            for lane in heat_lanes:
                if lane.racer_id is not None:
                    assert lane.racer_id in racing_group_racer_ids


def test_a_den_with_nobody_in_it_gets_no_round(db, client):
    race = _race(db, "Empty RacingGroup Derby", [3, 0, 3])

    body = _den_wizard(client, race.id)
    assert "errors" not in body, body

    rounds = body["data"]["createRoundWizard"]
    # The empty racing_group is skipped and the numbering stays gapless — a gap would
    # be a round advancement counts that does not exist.
    assert [r["name"] for r in rounds] == ["RacingGroup 1", "RacingGroup 3"]
    assert [r["roundNumber"] for r in rounds] == [1, 2]


def test_a_championship_round_continues_the_numbering(db, client):
    race = _race(db, "RacingGroup Finals Derby", [3, 3])

    body = _den_wizard(
        client,
        race.id,
        championship_rounds=[
            {"name": "Finals", "source": "ALL", "numTopRacers": 3, "runsPerLane": 1}
        ],
    )
    assert "errors" not in body, body

    rounds = body["data"]["createRoundWizard"]
    assert [r["roundNumber"] for r in rounds] == [1, 2, 3]
    assert rounds[-1]["name"] == "Finals"


def test_a_failure_after_the_den_rounds_rolls_them_all_back(db, client, monkeypatch):
    """#249's fix, on the branch the original test could not reach: several
    general rounds are already committed when a championship-phase failure
    hits, and every one of them must go."""
    race = _race(db, "RacingGroup Rollback Derby", [3, 3])

    real = crud.generate_heats_for_round

    def failing(db_arg, round_id, **kwargs):
        if kwargs.get("num_placeholders"):
            raise ValueError("a simulated championship-phase failure")
        return real(db_arg, round_id, **kwargs)

    monkeypatch.setattr(crud, "generate_heats_for_round", failing)

    body = _den_wizard(
        client,
        race.id,
        championship_rounds=[
            {"name": "Finals", "source": "ALL", "numTopRacers": 3, "runsPerLane": 1}
        ],
    )
    assert "errors" in body

    db.expire_all()
    assert db.query(models.Round).filter(models.Round.race_id == race.id).count() == 0

    monkeypatch.setattr(crud, "generate_heats_for_round", real)
    retry = _den_wizard(client, race.id)
    assert "errors" not in retry, retry
