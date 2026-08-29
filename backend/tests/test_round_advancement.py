from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.services import scoring
from backend.tests.helpers import as_lanes, lane_dicts


def test_advancement_restricted_to_round(db: Session):
    # 1. Setup Race and Config
    db.query(models.Heat).delete()
    db.query(models.Round).delete()
    db.query(models.Racer).delete()
    db.query(models.Race).delete()
    db.query(models.Organization).delete()
    db.query(models.Track).delete()
    db.commit()

    config = schemas.InitialConfigCreate(
        organization_name="Round Advancement Organization",
        tracks=[
            schemas.TrackCreate(
                name="Test Track",
                lane_count=4,
                length_feet=40,
                timer_type=models.TimerType.FAKE,
            )
        ],
    )
    crud.create_initial_config(db, config)
    group = db.query(models.Organization).first()
    track = db.query(models.Track).first()
    race_in = schemas.RaceCreate(
        name="Round Advancement Race", organization_id=group.id, track_id=track.id
    )
    crud.create_race(db, race_in)
    race = db.query(models.Race).first()

    # 2. Create 8 Racers
    racers = []
    for i in range(8):
        r = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        racers.append(r)
    db.commit()
    racers.sort(key=lambda x: x.id)

    # 3. Setup Rounds
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Qualifying")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)

    r2 = crud.create_round(
        db,
        race.id,
        2,
        models.SchedulingStrategy.PPC,
        "Champ A",
        advancement_source="ALL",
        advancement_num_racers=4,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=4)

    r3 = crud.create_round(
        db,
        race.id,
        3,
        models.SchedulingStrategy.PPC,
        "Champ B",
        advancement_source=f"ROUND:{r2.id}",
        advancement_num_racers=2,
    )
    db.flush()
    crud.generate_heats_for_round(db, r3.id, num_placeholders=2)

    # 4. Run Round 1
    r1_heats = crud.get_heats(db, race.id, round_id=r1.id)
    for heat in r1_heats:
        results = lane_dicts(db, heat)
        for res in results:
            rid = res.get("racer_id")
            if rid is None or rid < 0:
                continue
            idx = next(i for i, r in enumerate(racers) if r.id == rid)
            res["time"] = 0.1 if idx < 2 else (1.0 if idx < 4 else 2.0)
        crud.record_heat_result(
            db, heat.id, as_lanes(results), source=audit.ResultSource.OPERATOR
        )

    # Advance to R2
    winners_r2 = scoring.get_advancing_racers(
        db, race.id, r2.advancement_source, r2.advancement_num_racers
    )
    assert set(winners_r2) == {r.id for r in racers[:4]}
    crud.resolve_round_placeholders(db, r2.id, winners_r2)
    db.expire_all()

    # 5. Run Round 2
    # In R2: 2,3 (0.8s) vs 0,1 (1.1s)
    r2_heats = crud.get_heats(db, race.id, round_id=r2.id)
    for heat in r2_heats:
        results = lane_dicts(db, heat)
        for res in results:
            rid = res.get("racer_id")
            if rid is None or rid < 0:
                continue
            idx = next(i for i, r in enumerate(racers) if r.id == rid)
            if idx < 2:
                res["time"] = 1.1
            else:
                res["time"] = 0.8
        crud.record_heat_result(
            db, heat.id, as_lanes(results), source=audit.ResultSource.OPERATOR
        )

    # 6. Check Advancement to Round 3
    # R2 only winners: 2,3 (0.8s)
    winners_r3 = scoring.get_advancing_racers(
        db, race.id, r3.advancement_source, r3.advancement_num_racers
    )
    assert set(winners_r3) == {racers[2].id, racers[3].id}

    # Overall winners: 0,1 (avg (0.1+1.1)/2 = 0.6s) vs 2,3 (avg (1.0+0.8)/2 = 0.9s)
    winners_pack = scoring.get_advancing_racers(db, race.id, "ALL", 2)
    assert set(winners_pack) == {racers[0].id, racers[1].id}


def test_wizard_with_previous_round(client, db: Session):
    db.query(models.Heat).delete()
    db.query(models.Round).delete()
    db.query(models.Racer).delete()
    db.query(models.Race).delete()
    db.query(models.Organization).delete()
    db.query(models.Track).delete()
    db.commit()

    config = schemas.InitialConfigCreate(
        organization_name="Wizard Test Organization",
        tracks=[
            schemas.TrackCreate(
                name="Wizard Track",
                lane_count=4,
                length_feet=40,
                timer_type=models.TimerType.FAKE,
            )
        ],
    )
    crud.create_initial_config(db, config)
    group = db.query(models.Organization).first()
    track = db.query(models.Track).first()
    race_in = schemas.RaceCreate(
        name="Wizard Test Race", organization_id=group.id, track_id=track.id
    )
    crud.create_race(db, race_in)
    race = db.query(models.Race).first()

    for i in range(8):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    db.commit()

    mutation = """
    mutation CreateWizard($raceId: Int!, $config: WizardConfigurationInput!) {
        createRoundWizard(raceId: $raceId, config: $config) {
            id
            name
            roundNumber
            advancementSource
        }
    }
    """

    variables = {
        "raceId": race.id,
        "config": {
            "generalRound": {"type": "ALL", "runsPerLane": 1},
            "championshipRounds": [
                {
                    "name": "Semi-Finals",
                    "source": "ALL",
                    "numTopRacers": 4,
                    "runsPerLane": 1,
                },
                {
                    "name": "Finals",
                    "source": "PREVIOUS",
                    "numTopRacers": 2,
                    "runsPerLane": 1,
                },
            ],
        },
    }

    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    assert response.status_code == 200
    res_data = response.json()
    assert "errors" not in res_data
    data = res_data["data"]["createRoundWizard"]

    assert len(data) == 3

    rounds = db.query(models.Round).order_by(models.Round.round_number).all()
    assert len(rounds) == 3
    assert rounds[0].name == "All Pack"
    assert rounds[1].name == "Semi-Finals"
    assert rounds[1].advancement_source == "ALL"
    assert rounds[2].name == "Finals"
    assert rounds[2].advancement_source == f"ROUND:{rounds[1].id}"
