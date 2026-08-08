from backend.db import crud, schemas
from backend.tests.helpers import lane_dicts, record_heat_result


def test_auto_advancement_with_placeholders(client, db):
    """
    Regression test for bug where existing placeholder heats prevented auto-advancement.
    """
    # 1. Setup Race via CRUD
    group = crud.create_group(db, schemas.GroupCreate(name="Auto Advance Group"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Auto Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Auto Advance Race", group_id=group.id, track_id=track.id
        ),
    )

    # Create Racers (4 racers)
    den = crud.create_den(db, schemas.DenCreate(name="Den 1"), race.id)
    for i in range(4):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name=f"D{i}",
                race_id=race.id,
                den_id=den.id,
                car_passed_inspection=True,
            ),
        )

    # Create Rounds via GraphQL Wizard
    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race.id}, config: {{
            generalRound: {{ type: "PACK", runsPerLane: 1 }},
            championshipRounds: [{{
                name: "Championship",
                source: "PACK",
                numTopRacers: 2,
                runsPerLane: 1
            }}]
        }}) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_wizard})
    assert resp.status_code == 200
    assert "data" in resp.json()

    rounds = crud.get_rounds(db, race.id)
    assert len(rounds) == 2
    gen_round = rounds[0]
    champ_round = rounds[1]

    # Verify Champ round has placeholder heats
    champ_heats = crud.get_heats(db, race.id)
    champ_heats = [h for h in champ_heats if h.round_id == champ_round.id]
    assert len(champ_heats) > 0

    placeholder_found = False
    for h in champ_heats:
        results = lane_dicts(db, h)
        for r in results:
            if r.get("racer_id") is not None and r.get("racer_id") < 0:
                placeholder_found = True
                break
    assert placeholder_found

    # 2. Run all General Heats (manually update via GraphQL)
    gen_heats = [h for h in crud.get_heats(db, race.id) if h.round_id == gen_round.id]

    for heat in gen_heats:
        current_results = lane_dicts(db, heat)
        for lane_res in current_results:
            racer_id = lane_res.get("racer_id")
            if racer_id:
                lane_res["time"] = 1.0 + (racer_id * 0.1)
                lane_res["place"] = 1

        record_heat_result(client, heat.id, current_results)

    # 3. Verify Championship Advancement - Manual Advance required
    mutation_advance = f"""
    mutation {{
        advanceRound(raceId: {race.id}, roundId: {champ_round.id})
    }}
    """
    client.post("/graphql", json={"query": mutation_advance})

    db.expire_all()
    champ_heats_after = [
        h for h in crud.get_heats(db, race.id) if h.round_id == champ_round.id
    ]

    placeholders_remaining = False
    valid_racers_found = False
    for h in champ_heats_after:
        results = lane_dicts(db, h)
        for r in results:
            rid = r.get("racer_id")
            if rid is not None:
                if rid < 0:
                    placeholders_remaining = True
                else:
                    valid_racers_found = True

    assert not placeholders_remaining
    assert valid_racers_found
    print("Regression test passed!")
