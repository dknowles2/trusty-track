import json
import uuid

from backend.db import crud, schemas


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_rerun_last_heat_clears_next_round(client, db):
    # 1. Setup Race
    group_in = schemas.GroupCreate(name=get_unique_name("Rerun Group"))
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Rerun Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name=get_unique_name("Rerun Race"), group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    race_id = race.id

    # 2. Add Racers
    for i in range(4):
        r_in = schemas.RacerCreate(
            first_name=f"R{i}",
            last_name="T",
            car_number=i,
            race_id=race_id,
            car_passed_inspection=True,
        )
        crud.create_racer(db, r_in)

    # 3. Create General Round (Round 1)
    mutation_r1 = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "General",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            generalType: "PACK"
        }}) {{
            id
        }}
    }}
    """
    client.post("/graphql", json={"query": mutation_r1})
    rounds = crud.get_rounds(db, race_id)
    gen_round_id = rounds[0].id

    # 4. Create Championship Round (Round 2)
    mutation_r2 = f"""
    mutation {{
        createRound(raceId: {race_id}, roundData: {{
            name: "Championship",
            schedulingStrategy: "PPC",
            runsPerLane: 1,
            advancementSource: "PACK",
            advancementNumRacers: 2
        }}) {{
            id
        }}
    }}
    """
    client.post("/graphql", json={"query": mutation_r2})
    # Need to refresh rounds to get ID
    db.expire_all()
    rounds = crud.get_rounds(db, race_id)
    champ_round_id = rounds[1].id

    # 5. Run General Round Heats
    heats = crud.get_heats(db, race_id)
    gen_heats = [h for h in heats if h.round_id == gen_round_id]

    # Fill results
    for heat in gen_heats:
        results = []
        lane_assignment = json.loads(heat.lane_results)
        for i, lane in enumerate(lane_assignment):
            lane["time"] = 1.0 + (i * 0.1)
            results.append(lane)

        results_str = json.dumps(results).replace('"', '\\"')
        mutation_update = f"""
        mutation {{
            updateHeatResult(heatId: {heat.id}, results: "{results_str}") {{
                id
            }}
        }}
        """
        client.post("/graphql", json={"query": mutation_update})

    # 6. Verify Championship Round is Populated - Manually Advance
    mutation_advance = f"""
    mutation {{
        advanceRound(raceId: {race_id}, roundId: {champ_round_id})
    }}
    """
    res = client.post("/graphql", json={"query": mutation_advance})
    assert res.json()["data"]["advanceRound"] == 2

    # Check
    db.expire_all()
    heats = crud.get_heats(db, race_id)
    champ_heats = [h for h in heats if h.round_id == champ_round_id]
    first_heat_results = json.loads(champ_heats[0].lane_results)
    assert any(r["racer_id"] > 0 for r in first_heat_results)

    # 7. Rerun Last Heat of General Round
    last_heat = gen_heats[-1]
    results = json.loads(last_heat.lane_results)
    for r in results:
        r["time"] = None

    results_str = json.dumps(results).replace('"', '\\"')
    mutation_update_clear = f"""
    mutation {{
        updateHeatResult(heatId: {last_heat.id}, results: "{results_str}") {{
            id
        }}
    }}
    """
    client.post("/graphql", json={"query": mutation_update_clear})

    # 8. Assert Championship Round is Cleared
    db.expire_all()
    heats = crud.get_heats(db, race_id)
    champ_heats_after = [h for h in heats if h.round_id == champ_round_id]
    first_heat_results_after = json.loads(champ_heats_after[0].lane_results)

    has_actual_racers = any(
        r["racer_id"] is not None and r["racer_id"] > 0
        for r in first_heat_results_after
    )

    assert not has_actual_racers, "Championship round should be cleared"
