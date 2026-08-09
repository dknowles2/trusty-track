from backend.db import crud, models, schemas
from backend.domain import audit, lanes
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


def test_a_skipped_heat_does_not_stall_the_final(db):
    """#224. Skipping one prelim heat used to leave the round incomplete
    forever, so the championship's placeholders never filled and the operator
    saw a final that never became ready — with the manual Advance button as
    the only, undocumented, way out.

    This is the executed probe that confirmed the bug, inverted: it now
    asserts the final fills.
    """
    group = crud.create_group(db, schemas.GroupCreate(name="Skip Stall Group"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Skip Stall Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Skip Stall Race", group_id=group.id, track_id=track.id
        ),
    )
    for i in range(4):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="Skip",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )

    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, prelim.id)
    final = crud.create_round(
        db,
        race_id=race.id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=2,
    )
    crud.generate_heats_for_round(db, final.id)

    heats = sorted(
        db.query(models.Heat).filter(models.Heat.round_id == prelim.id).all(),
        key=lambda h: h.heat_number,
    )

    # Race every heat but the last; skip that one exactly as the UI does —
    # skipped lanes, no times, no places.
    for heat in heats[:-1]:
        raced = [
            lanes.Lane(
                lane=ln.lane,
                racer_id=ln.racer_id,
                time=3.0 + ln.lane / 10,
                place=ln.lane,
            )
            for ln in crud.heat_lanes_of(db, heat)
            if ln.racer_id is not None
        ]
        crud.record_heat_result(db, heat.id, raced, source=audit.ResultSource.OPERATOR)

    skipped = [
        lanes.Lane(lane=ln.lane, racer_id=ln.racer_id, skipped=True)
        for ln in crud.heat_lanes_of(db, heats[-1])
        if ln.racer_id is not None
    ]
    crud.record_heat_result(
        db, heats[-1].id, skipped, source=audit.ResultSource.OPERATOR
    )

    assert crud.is_round_complete(db, prelim.id)
    unfilled = {
        lane.placeholder_slot
        for heat_lanes in crud._round_heat_lanes(db, final.id)
        for lane in heat_lanes
        if lane.placeholder_slot is not None
    }
    assert unfilled == set(), f"the final still holds open slots: {unfilled}"
