from backend.db import crud, schemas


def create_test_race(db):
    group_in = schemas.GroupCreate(name="Schedule Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Schedule Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name="Schedule Race", group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    return race.id


def test_generate_schedule_not_enough_racers(client, db):
    race_id = create_test_race(db)

    # 2. Add 1 Racer
    r_in = schemas.RacerCreate(
        first_name="Lonely", last_name="Racer", car_number=99, race_id=race_id
    )
    crud.create_racer(db, r_in)

    # 3. Try to create a round - Should FAIL
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    # GraphQL returns data:null and errors
    assert "errors" in resp.json()
    assert "not enough racers" in resp.json()["errors"][0]["message"].lower()


def test_generate_schedule_success_with_min_racers(client, db):
    race_id = create_test_race(db)

    # Ensure 2 racers
    for i in range(2):
        r_in = schemas.RacerCreate(
            first_name=f"Racer{i}",
            last_name="Test",
            car_number=100 + i,
            race_id=race_id,
            car_passed_inspection=True,
        )
        crud.create_racer(db, r_in)

    # Create a round - Should SUCCEED
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ id }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    assert "data" in resp.json()
    assert resp.json()["data"]["createRound"] is not None
    rounds_data = resp.json()["data"]["createRound"]
    assert len(rounds_data) > 0

    # Check heats count.
    heats = rounds_data[0]["heats"]
    assert len(heats) > 0


def test_generate_ppc_schedule(client, db):
    race_id = create_test_race(db)

    # Ensure 2 racers
    for i in range(2):
        r_in = schemas.RacerCreate(
            first_name=f"PPC_Racer{i}",
            last_name="Test",
            car_number=200 + i,
            race_id=race_id,
            car_passed_inspection=True,
        )
        crud.create_racer(db, r_in)

    # Create a round
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "PPC Round",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ id }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    assert "data" in resp.json()
    rounds = resp.json()["data"]["createRound"]
    assert len(rounds) > 0
    assert len(rounds[0]["heats"]) > 0


# --------------------------------------------------------------------------- #
# A lane out of service (#171)                                                 #
# --------------------------------------------------------------------------- #


def test_a_gapped_track_writes_the_lane_numbers_that_exist(db):
    """`_generate_ppc` must store the lane a racer is actually in.

    The rows it writes are the only place the position-versus-lane-number
    distinction becomes visible, and it is invisible on an undamaged track
    because the two agree. Handed `[1, 2, 4]` the old code wrote lanes 1, 2 and
    3 — so lane 4's racer was recorded as having run in a lane that was out of
    service, and the lane fairness stats in `RaceStats` would have counted it
    there too.
    """
    race_id = create_test_race(db)
    for i in range(4):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Gapped{i}",
                last_name="Test",
                car_number=300 + i,
                race_id=race_id,
                car_passed_inspection=True,
            ),
        )

    round_obj = crud.create_round(db, race_id=race_id, round_number=1, name="Gapped")
    racer_ids = [r.id for r in crud.get_racers(db, race_id=race_id)]
    heats = crud._generate_ppc(db, race_id, round_obj.id, racer_ids, [1, 2, 4])
    db.commit()

    assert heats, "a gapped track should still produce a schedule"
    for heat in heats:
        lane_numbers = sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
        assert lane_numbers == [1, 2, 4], (
            f"heat {heat.heat_number} was written into lanes {lane_numbers}"
        )


def test_an_undamaged_track_still_numbers_its_lanes_from_one(db):
    """The ordinary case, so the change above cannot have shifted it."""
    race_id = create_test_race(db)
    for i in range(3):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Intact{i}",
                last_name="Test",
                car_number=400 + i,
                race_id=race_id,
                car_passed_inspection=True,
            ),
        )

    assert crud.usable_lanes_for_race(db, race_id) == [1, 2, 3, 4]

    round_obj = crud.create_round(db, race_id=race_id, round_number=1, name="Intact")
    crud.generate_heats_for_round(db, round_obj.id)

    for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
        lane_numbers = sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
        assert lane_numbers == [1, 2, 3, 4]


def test_rewriting_a_round_in_place_also_uses_the_lane_numbers(db):
    """The second write path, which #50 added and which is easy to miss.

    `_reset_heats_in_place` rewrites a championship round's existing rows so
    their ids survive re-advancement. It builds its own schedule, so it has its
    own copy of the position-to-lane mapping — and #48 is the standing reminder
    about a rule that lands on only some of the paths that need it.
    """
    race_id = create_test_race(db)
    for i in range(3):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Reset{i}",
                last_name="Test",
                car_number=500 + i,
                race_id=race_id,
                car_passed_inspection=True,
            ),
        )

    round_obj = crud.create_round(db, race_id=race_id, round_number=1, name="Reset")
    crud.generate_heats_for_round(db, round_obj.id)
    racer_ids = [r.id for r in crud.get_racers(db, race_id=race_id)]

    assert crud._reset_heats_in_place(db, round_obj.id, racer_ids, [1, 2, 4])

    for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
        lane_numbers = sorted(lane.lane for lane in crud.heat_lanes_of(db, heat))
        assert lane_numbers == [1, 2, 4], (
            f"heat {heat.heat_number} was rewritten into lanes {lane_numbers}"
        )
