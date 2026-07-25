import json

from backend.db import crud, schemas
from backend.tests.helpers import record_heat_result


def test_full_advancement_flow(client, db):
    # 1. Setup: Create race, den, and racers via CRUD
    group_in = schemas.GroupCreate(name="Pack 123")
    group = crud.create_group(db, group_in)

    track_in = schemas.TrackCreate(name="Advantage Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name="Championship Test", group_id=group.id, track_id=track.id
    )
    race = crud.create_race(db, race_in)
    race_id = race.id

    den_in = schemas.DenCreate(name="Bears", color="#ff0000")
    den = crud.create_den(db, den_in, race_id)
    den_id = den.id

    # Create 4 racers
    racer_ids = []
    for i in range(4):
        r_in = schemas.RacerCreate(
            first_name="Racer",
            last_name=str(i),
            car_number=100 + i,
            den_id=den_id,
            race_id=race_id,
            car_passed_inspection=True,
        )
        r = crud.create_racer(db, r_in)
        racer_ids.append(r.id)

    # 2. Run Wizard via GraphQL
    mutation_wizard = f"""
    mutation {{
        createRoundWizard(raceId: {race_id}, config: {{
            generalRound: {{ type: "PACK", runsPerLane: 1 }},
            championshipRounds: [{{
                name: "Finals",
                source: "PACK",
                numTopRacers: 2,
                runsPerLane: 1
            }}]
        }}) {{
            id
            name
        }}
    }}
    """
    resp = client.post("/graphql", json={"query": mutation_wizard})
    rounds = resp.json()["data"]["createRoundWizard"]
    assert len(rounds) == 2
    round1_id = int(rounds[0]["id"])
    round2_id = int(rounds[1]["id"])

    # 3. Verify placeholders in Round 2 via CRUD (the check reads the DB)
    heats_r2 = crud.get_heats(db, race_id)
    heats_r2 = [h for h in heats_r2 if h.round_id == round2_id]
    assert (
        len(heats_r2) > 0
    )  # Depends on lanes/racers, but for 2 racers/4 lanes -> 1 heat or more?
    # Wait, placeholder is for 2 racers.

    res0 = json.loads(heats_r2[0].lane_results)
    # Placeholder IDs are negative or we check logic
    # In `crud.generate_placeholder_heats`, it uses negative IDs.
    assert res0[0]["racer_id"] < 0

    # 4. Check Status via GraphQL
    query_status = f"""
    query {{
        advancementStatus(raceId: {race_id}, roundId: {round2_id}) {{
            isReady
            requiresAdvancement
            alreadyAdvanced
        }}
    }}
    """
    status = client.post("/graphql", json={"query": query_status}).json()["data"][
        "advancementStatus"
    ]
    assert status["isReady"] is False
    assert status["requiresAdvancement"] is True
    assert status["alreadyAdvanced"] is False

    # 5. Record results for Round 1
    heats_r1 = [h for h in crud.get_heats(db, race_id) if h.round_id == round1_id]

    for h in heats_r1:
        lane_res = json.loads(h.lane_results)
        for res in lane_res:
            rid = res["racer_id"]
            if rid == racer_ids[0]:
                res["time"] = 1.0
            elif rid == racer_ids[1]:
                res["time"] = 2.0
            elif rid == racer_ids[2]:
                res["time"] = 3.0
            else:
                res["time"] = 4.0
            # Place is recomputed by scoring for TIMED races; any value will do.
            res["place"] = 1
            # Actually scoring.py calculates score based on strategy. Default is TIMED.

        record_heat_result(client, h.id, lane_res)

    # 6. Check Status: Should be READY
    status = client.post("/graphql", json={"query": query_status}).json()["data"][
        "advancementStatus"
    ]
    assert status["isReady"] is True

    # 7. Advance!
    mutation_advance = f"""
    mutation {{
        advanceRound(raceId: {race_id}, roundId: {round2_id})
    }}
    """
    adv_resp = client.post("/graphql", json={"query": mutation_advance})
    assert adv_resp.json()["data"]["advanceRound"] == 2

    # 8. Verify Round 2 heats no longer have placeholders
    db.expire_all()  # Refresh session
    heats_after = crud.get_heats(db, race_id)
    heats_r2_after = [h for h in heats_after if h.round_id == round2_id]

    res0_after = json.loads(heats_r2_after[0].lane_results)
    # Check if we have positive IDs now
    assert res0_after[0]["racer_id"] in [racer_ids[0], racer_ids[1]]
    assert res0_after[0]["racer_id"] > 0

    # Check already_advanced status
    status = client.post("/graphql", json={"query": query_status}).json()["data"][
        "advancementStatus"
    ]
    assert status["alreadyAdvanced"] is True
