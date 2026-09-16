"""The `algorithm` seam is reachable through the GraphQL API (#1090, part B),
and the wizard's own "How heats are built" choice reads `Query.
schedulingAlgorithms` for the field/lane shape it is about to schedule
(part D): `createRound`, `createRoundWizard`, `Round.algorithm`, the
round-plan copy, and now `schedulingAlgorithms` itself all carry
`SchedulingAlgorithm` through, end to end.
"""

from backend.db import crud, models, schemas
from backend.domain.schedulers import SCHEDULERS
from backend.domain.schedulers.perfect_n import default_chart


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


# --------------------------------------------------------------------------- #
# `Query.schedulingAlgorithms` (#1090, part D) — the wizard's "How heats are
# built" choice reads this to know which algorithms exist, which one this
# exact field/lane shape can actually use, and (for Perfect-N) how many
# heats one run produces.
#
# The rule itself — `available_for`, `heat_count`, the registry order — is
# `domain/schedulers`' own and is exercised exhaustively by
# `test_scheduler_registry.py` and `test_domain_scheduling.py`. These tests
# only check the GraphQL surface reports what the registry says, for the one
# shape whose answer genuinely depends on the racer/lane count: Perfect-N.
# --------------------------------------------------------------------------- #

SCHEDULING_ALGORITHMS_QUERY = """
query SchedulingAlgorithms($racerCount: Int!, $laneCount: Int!) {
    schedulingAlgorithms(racerCount: $racerCount, laneCount: $laneCount) {
        value
        label
        guarantee
        unavailableReason
        absorbsLatecomer
        heatCount
    }
}
"""

# 9 racers / 4 lanes: `perfect_n_tables.CHARTS` has an entry whose heat count
# (18) is *not* the racer count — chosen deliberately over a shape like
# 5/4 (`P5-4 (3)`, heats == racers) so this file actually exercises the case
# `heatCount` exists to report: a Perfect-N chart's own heat count is
# whatever Pope's directory lists, not always one per racer.
COVERED_RACERS, COVERED_LANES = 9, 4

# 2 racers / 4 lanes: no published chart starts below 4 cars on 4 lanes, so
# this shape is refused — not a special case `available_for` shortcuts
# (only 0 racers/lanes is), a genuine "nothing this small is published".
UNCOVERED_RACERS, UNCOVERED_LANES = 2, 4


def _scheduling_algorithms(client, racer_count: int, lane_count: int):
    response = client.post(
        "/graphql",
        json={
            "query": SCHEDULING_ALGORITHMS_QUERY,
            "variables": {"racerCount": racer_count, "laneCount": lane_count},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "errors" not in body, body
    return body["data"]["schedulingAlgorithms"]


def test_scheduling_algorithms_order_is_ppc_first(client):
    """PPC is the default and stays first regardless of shape — the wizard
    relies on this to preselect it without a second rule of its own."""
    options = _scheduling_algorithms(client, COVERED_RACERS, COVERED_LANES)
    assert [o["value"] for o in options] == list(SCHEDULERS)
    assert options[0]["value"] == "PPC"


def test_scheduling_algorithms_carry_the_registry_fields(client):
    options = _scheduling_algorithms(client, COVERED_RACERS, COVERED_LANES)
    by_value = {o["value"]: o for o in options}
    assert set(by_value) == set(SCHEDULERS)
    for value, scheduler in SCHEDULERS.items():
        option = by_value[value]
        assert option["label"] == scheduler.label
        assert option["guarantee"] == scheduler.guarantee
        assert option["absorbsLatecomer"] == scheduler.absorbs_latecomer


def test_ppc_and_rotation_are_always_available_with_no_heat_count(client):
    """Neither algorithm ever refuses a shape, and both produce exactly one
    heat per racer per run — so `heatCount` stays null, the "use
    `racerCount`" signal, at both the covered and the uncovered shape."""
    for racers, lanes in [
        (COVERED_RACERS, COVERED_LANES),
        (UNCOVERED_RACERS, UNCOVERED_LANES),
    ]:
        options = _scheduling_algorithms(client, racers, lanes)
        by_value = {o["value"]: o for o in options}
        for value in ("PPC", "ROTATION"):
            assert by_value[value]["unavailableReason"] is None
            assert by_value[value]["heatCount"] is None


def test_perfect_n_reports_a_reason_at_an_uncovered_shape(client):
    options = _scheduling_algorithms(client, UNCOVERED_RACERS, UNCOVERED_LANES)
    by_value = {o["value"]: o for o in options}
    perfect_n = by_value["PERFECT_N"]

    assert default_chart(UNCOVERED_RACERS, UNCOVERED_LANES) is None
    assert perfect_n["unavailableReason"] is not None
    assert perfect_n["heatCount"] is None
    # Named as a real refusal, matching `Scheduler.available_for` — not a
    # bare "no".
    assert str(UNCOVERED_LANES) in perfect_n["unavailableReason"]


def test_perfect_n_reports_no_reason_and_the_chart_heat_count_at_a_covered_shape(
    client,
):
    options = _scheduling_algorithms(client, COVERED_RACERS, COVERED_LANES)
    by_value = {o["value"]: o for o in options}
    perfect_n = by_value["PERFECT_N"]

    chart = default_chart(COVERED_RACERS, COVERED_LANES)
    assert chart is not None
    assert perfect_n["unavailableReason"] is None
    assert perfect_n["heatCount"] == chart.heats
    # Never simply the racer count for this shape (part C's own point) — a
    # test that never actually exercises the "not the racer count" case
    # would not have caught a bug in the wizard's own heat-count estimate.
    assert chart.heats != COVERED_RACERS
