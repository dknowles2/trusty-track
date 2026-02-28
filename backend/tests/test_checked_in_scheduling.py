import pytest

from backend.db import crud, schemas


def create_test_race(db):
    group_in = schemas.GroupCreate(name="Check-in Group")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Check-in Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name="Check-in Race", group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    return race.id


def test_generate_schedule_only_checked_in(client, db):
    race_id = create_test_race(db)

    # 1. Add 3 racers, but only 1 checked-in
    racers = []
    # Checked-in racer
    r1 = schemas.RacerCreate(
        first_name="Checked",
        last_name="In",
        car_number=1,
        race_id=race_id,
        car_passed_inspection=True,
    )
    racers.append(crud.create_racer(db, r1))

    # Not checked-in racer
    r2 = schemas.RacerCreate(
        first_name="Not",
        last_name="CheckedIn",
        car_number=2,
        race_id=race_id,
        car_passed_inspection=False,
    )
    racers.append(crud.create_racer(db, r2))

    # Another not checked-in racer
    r3 = schemas.RacerCreate(
        first_name="Pending",
        last_name="Inspection",
        car_number=3,
        race_id=race_id,
        car_passed_inspection=False,
    )
    racers.append(crud.create_racer(db, r3))

    # 2. Try to create a round.
    # Currently it will SUCCEED because it doesn't filter by checked-in status.
    # It should FAIL because only 1 racer is checked-in.

    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ 
                id 
                laneResults
            }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})

    # REPRODUCTION: Currently this fails to fail. We want it to FAIL.
    # If the bug is present, resp.json()["data"]["createRound"] will have data.
    # We want it to have an error "Not enough racers to generate a schedule (minimum 2 required)"

    if "errors" in resp.json():
        assert "not enough racers" in resp.json()["errors"][0]["message"].lower()
    else:
        # If it succeeded, check how many racers are in the heats
        data = resp.json()["data"]["createRound"]
        assert data is not None
        import json

        all_racer_ids = set()
        for round_obj in data:
            for heat in round_obj["heats"]:
                results = json.loads(heat["laneResults"])
                for r in results:
                    if r["racer_id"] is not None:
                        all_racer_ids.add(r["racer_id"])

        # If the bug is present, all 3 racers will be scheduled
        if len(all_racer_ids) > 1:
            pytest.fail(
                f"Bug reproduced: Scheduled {len(all_racer_ids)} racers, but only 1 was checked in."
            )


def test_generate_schedule_multiple_checked_in(client, db):
    race_id = create_test_race(db)

    # 1. Add 4 racers, 2 checked-in, 2 not
    # Checked-in
    for i in range(2):
        r = schemas.RacerCreate(
            first_name=f"Checked{i}",
            last_name="In",
            car_number=10 + i,
            race_id=race_id,
            car_passed_inspection=True,
        )
        crud.create_racer(db, r)

    # Not checked-in
    for i in range(2):
        r = schemas.RacerCreate(
            first_name=f"NotChecked{i}",
            last_name="In",
            car_number=20 + i,
            race_id=race_id,
            car_passed_inspection=False,
        )
        crud.create_racer(db, r)

    # 2. Create a round. Should only include the 2 checked-in racers.
    mutation_round = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "R1",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
            heats {{ 
                id 
                laneResults
            }}
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_round})
    assert "errors" not in resp.json()

    data = resp.json()["data"]["createRound"]
    import json

    all_racer_ids = set()
    for round_obj in data:
        for heat in round_obj["heats"]:
            results = json.loads(heat["laneResults"])
            for r in results:
                if r["racer_id"] is not None:
                    all_racer_ids.add(r["racer_id"])

    # Only 2 racers should be scheduled
    assert len(all_racer_ids) == 2, (
        f"Expected 2 racers scheduled, but got {len(all_racer_ids)}"
    )
