"""The `algorithm` seam is reachable through the GraphQL API (#1090, part B).

No wizard UI offers this yet (part D) — these tests are what "settable
through the API so tests can exercise it" means: `createRound`,
`createRoundWizard`, `Round.algorithm`, and the round-plan copy each carry
`SchedulingAlgorithm` through, end to end.
"""

from backend.db import crud, models, schemas


def _race(db, *, lane_count=4, racer_count=6, label="AlgoAPI"):
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            organization_id=org.id,
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


CREATE_ROUND = """
mutation Create($raceId: Int!, $round: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $round) {
        id
        algorithm
    }
}
"""


def test_create_round_defaults_algorithm_to_ppc(db, client):
    race = _race(db, label="DefaultAlgo")
    response = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {"raceId": race.id, "round": {}},
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [round_data] = body["data"]["createRound"]
    assert round_data["algorithm"] == "PPC"


def test_create_round_accepts_rotation(db, client):
    race = _race(db, label="RotationAlgo")
    response = client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {
                "raceId": race.id,
                "round": {"algorithm": "ROTATION"},
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [round_data] = body["data"]["createRound"]
    assert round_data["algorithm"] == "ROTATION"

    round_obj = db.query(models.Round).filter(models.Round.id == round_data["id"]).one()
    assert round_obj.algorithm == models.SchedulingAlgorithm.ROTATION

    # And the heats it built actually came from the rotation scheduler, not
    # silently from PPC: every car's lane advances by one from its previous
    # heat, which PPC's opponent-variety heuristic does not guarantee.
    heats = sorted(
        crud.get_heats(db, race.id, round_id=round_obj.id), key=lambda h: h.heat_number
    )
    lane_by_heat_for_racer: dict[int, dict[int, int]] = {}
    for heat in heats:
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id is not None:
                lane_by_heat_for_racer.setdefault(lane.racer_id, {})[
                    heat.heat_number
                ] = lane.lane
    window = min(6, 4)
    for racer_id, by_heat in lane_by_heat_for_racer.items():
        for heat_number, lane_number in by_heat.items():
            nxt = heat_number + 1
            if nxt in by_heat:
                # Lanes are 1..4 here (no outage), so mod arithmetic over the
                # window is the same as mod over the lane numbers themselves.
                assert by_heat[nxt] == (lane_number % window) + 1, (
                    racer_id,
                    heat_number,
                    by_heat,
                )


WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
        id
        algorithm
    }
}
"""


def test_wizard_accepts_rotation_for_the_general_round(db, client):
    race = _race(db, label="WizardRotation")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "algorithm": "ROTATION",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    assert general["algorithm"] == "ROTATION"


ROUND_PLAN = """
query Plan($raceId: Int!) {
    race(raceId: $raceId) {
        roundPlan {
            generalRound {
                algorithm
            }
        }
    }
}
"""


def test_round_plan_carries_the_algorithm_forward_for_copying(db, client):
    race = _race(db, label="PlanAlgo")
    crud.create_round(
        db,
        race_id=race.id,
        round_number=1,
        algorithm=models.SchedulingAlgorithm.ROTATION,
    )

    response = client.post(
        "/graphql", json={"query": ROUND_PLAN, "variables": {"raceId": race.id}}
    )
    body = response.json()
    assert "errors" not in body, body
    assert body["data"]["race"]["roundPlan"]["generalRound"]["algorithm"] == "ROTATION"
