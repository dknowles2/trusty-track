"""Correcting a general-round result invalidates a raced championship round.

Exercised through the mutations an operator actually uses, rather than
`invalidate_future_rounds` directly, so this pins the same GraphQL round trip
`test_championship_chains.py::TestTheResolverPaths` uses for the fill side of
the cascade.
"""

import uuid

from backend.db import crud, schemas
from backend.tests.helpers import lane_dicts, record_heat_result

CREATE_ROUND = """
mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $roundData) { id }
}
"""

ADVANCE_ROUND = """
mutation Advance($raceId: Int!, $roundId: Int!) {
    advanceRound(raceId: $raceId, roundId: $roundId)
}
"""


def get_unique_name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4()}"


def test_rerun_last_heat_clears_next_round(client, db):
    # 1. Setup Race
    group_in = schemas.OrganizationCreate(name=get_unique_name("Rerun Organization"))
    group = crud.create_organization(db, group_in)

    track_in = schemas.TrackCreate(name="Rerun Track", lane_count=4)
    track = crud.create_track(db, track_in)

    race_in = schemas.RaceCreate(
        name=get_unique_name("Rerun Race"), organization_id=group.id, track_id=track.id
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
    response = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race_id,
                "roundData": {
                    "name": "General",
                    "schedulingStrategy": "PPC",
                    "runsPerLane": 1,
                    "generalType": "ALL",
                },
            },
        },
    )
    assert "errors" not in response.json(), response.json()
    rounds = crud.get_rounds(db, race_id)
    gen_round_id = rounds[0].id

    # 4. Create Championship Round (Round 2)
    response = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race_id,
                "roundData": {
                    "name": "Championship",
                    "schedulingStrategy": "PPC",
                    "runsPerLane": 1,
                    "advancementSource": "ALL",
                    "advancementNumRacers": 2,
                },
            },
        },
    )
    assert "errors" not in response.json(), response.json()
    db.expire_all()
    rounds = crud.get_rounds(db, race_id)
    champ_round_id = rounds[1].id

    # 5. Run General Round Heats
    heats = crud.get_heats(db, race_id)
    gen_heats = [h for h in heats if h.round_id == gen_round_id]

    for heat in gen_heats:
        results = []
        lane_assignment = lane_dicts(db, heat)
        for i, lane in enumerate(lane_assignment):
            lane["time"] = 1.0 + (i * 0.1)
            results.append(lane)

        record_heat_result(client, heat.id, results)

    # 6. Verify Championship Round is Populated - Manually Advance
    response = client.post(
        "/graphql",
        json={
            "query": ADVANCE_ROUND,
            "variables": {"raceId": race_id, "roundId": champ_round_id},
        },
    )
    assert response.json()["data"]["advanceRound"] == 2

    db.expire_all()
    heats = crud.get_heats(db, race_id)
    champ_heats = [h for h in heats if h.round_id == champ_round_id]
    assert champ_heats, "the championship round should have scheduled heats"
    champ_lanes = [lane for heat in champ_heats for lane in lane_dicts(db, heat)]
    assert any(r["racer_id"] > 0 for r in champ_lanes), (
        "advancing should have filled at least one lane with a real racer"
    )

    # 7. Rerun Last Heat of General Round
    last_heat = gen_heats[-1]
    results = lane_dicts(db, last_heat)
    for r in results:
        r["time"] = None

    record_heat_result(client, last_heat.id, results)

    # 8. Assert the whole Championship Round reverted to placeholders, not
    # merely its first heat -- a correction to any general-round result
    # invalidates every heat drawn from those standings.
    db.expire_all()
    heats = crud.get_heats(db, race_id)
    champ_heats_after = [h for h in heats if h.round_id == champ_round_id]
    assert champ_heats_after, "the championship round must still exist"
    champ_lanes_after = [
        lane for heat in champ_heats_after for lane in lane_dicts(db, heat)
    ]
    assert champ_lanes_after, "the championship round must still have lanes"

    has_actual_racers = any(
        r["racer_id"] is not None and r["racer_id"] > 0 for r in champ_lanes_after
    )
    assert not has_actual_racers, (
        "every lane of every championship heat should be back to a placeholder"
    )
