"""The Round Wizard chaining an elimination qualifier into a final (#1012, #1025).

Elimination heats never feed the aggregate standings (CLAUDE.md's "Ladderless
elimination" — a car that is knocked out early races fewer heats, so no
average or total over them is fair). `createRoundWizard` used to wire its
*first* championship round to whatever source the frontend sent for it —
"ALL" or "EACH_GROUP" by default — without regard for what the general round
actually was. When that general round was Elimination, the final's source
named a standings view with nothing in it: no preliminary racer is ever in
the aggregate standings, so the final could never fill. #975 made Elimination
reachable from the wizard's step 1 without teaching step 2 the source that
actually works.

The fix chains the first championship round to the elimination round's own
survival ranking instead — `ROUND:<elimination round id>`, the same
`"the top finishers of another round"` source `RoundConfigModal`'s Add Round
dialog already offers by hand (`lastChampionshipRound`). Nothing in the suite
had driven the wizard with a non-PPC general round *and* a championship round
together before this — the gap #1025 calls out.
"""

from backend.db import crud, models, schemas
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource

WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
        id
        roundNumber
        name
        schedulingStrategy
        advancementSource
    }
}
"""


def _race(db, name, racer_count=4, lane_count=4):
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{name} Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{name} Track", lane_count=lane_count, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=name,
            organization_id=org.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    ids = [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                first_name=f"Racer{n}",
                last_name="Elim",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(racer_count)
    ]
    return race, ids


def _pending_heats(db, round_id):
    heats = (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_id)
        .order_by(models.Heat.heat_number)
        .all()
    )
    return [h for h in heats if not lanes_module.is_finished(crud.heat_lanes_of(db, h))]


def _run_heat_favouring(db, heat, favourite_order):
    """Record a heat: the earlier a racer appears in the order, the better —
    matches `test_elimination.py`'s own helper, so the race-to-a-winner loop
    below reads the same way."""
    stored = crud.heat_lanes_of(db, heat)
    racing = [lane for lane in stored if lane.racer_id]
    order = sorted(racing, key=lambda lane: favourite_order.index(lane.racer_id))
    recorded = [
        lanes_module.Lane(
            lane=lane.lane,
            racer_id=lane.racer_id,
            time=3.0 + order.index(lane) * 0.1,
            place=order.index(lane) + 1,
        )
        if lane.racer_id
        else lane
        for lane in stored
    ]
    crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)


def _run_elimination_round_to_a_winner(db, round_id, favourite_order, max_waves=50):
    for _ in range(max_waves):
        pending = _pending_heats(db, round_id)
        if not pending:
            return
        for heat in pending:
            _run_heat_favouring(db, heat, favourite_order)
    raise AssertionError("the elimination round never finished")


def _create_wizard(client, race_id, championship_source="ALL"):
    return client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race_id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "ELIMINATION",
                        "eliminationLosses": 1,
                    },
                    "championshipRounds": [
                        {
                            "name": "Grand Finals",
                            "source": championship_source,
                            "numTopRacers": 1,
                            "runsPerLane": 1,
                        }
                    ],
                },
            },
        },
    ).json()


def test_the_final_chains_to_the_elimination_round_rather_than_all(db, client):
    race, ids = _race(db, "WizardElimFinalChain")

    body = _create_wizard(client, race.id)
    assert "errors" not in body, body

    elim, final = body["data"]["createRoundWizard"]
    assert elim["schedulingStrategy"] == "ELIMINATION"
    # The bug: this used to read "ALL", a standings view elimination heats
    # never feed — so the final could never fill.
    assert final["advancementSource"] == f"ROUND:{elim['id']}"


def test_each_group_is_overridden_the_same_way(db, client):
    """An API caller — not just the UI's own default — can ask for
    "EACH_GROUP" too; the backend must do the right thing regardless of what
    the frontend offers."""
    race, ids = _race(db, "WizardElimFinalChainEachGroup")

    body = _create_wizard(client, race.id, championship_source="EACH_GROUP")
    assert "errors" not in body, body

    elim, final = body["data"]["createRoundWizard"]
    assert final["advancementSource"] == f"ROUND:{elim['id']}"


def test_the_final_fills_with_the_elimination_rounds_survivors(db, client):
    race, ids = _race(db, "WizardElimFinalSurvivors", racer_count=4, lane_count=4)

    body = _create_wizard(client, race.id)
    assert "errors" not in body, body
    elim, final = body["data"]["createRoundWizard"]

    # Race the elimination round down to its one winner — `ids[0]` always
    # wins under `_run_heat_favouring`'s ordering.
    _run_elimination_round_to_a_winner(db, elim["id"], favourite_order=ids)

    db.expire_all()
    final_round = db.get(models.Round, final["id"])
    assert final_round is not None

    final_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == final_round.id).all()
    )
    seated_racer_ids = {
        lane.racer_id
        for heat_lanes in crud.lanes_for_heats(db, final_heats)
        for lane in heat_lanes
        if lane.racer_id is not None and lane.racer_id > 0
    }
    # The final asked for the top 1: the sole survivor, not a placeholder
    # and not the whole (empty, for an elimination source) aggregate field.
    assert seated_racer_ids == {ids[0]}
