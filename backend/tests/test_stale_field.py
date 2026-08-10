"""A raced final whose field the standings have moved on from (#229).

Invalidation deliberately leaves a raced championship round alone when an
earlier result changes — wiping heats people ran would be worse. The premise
was "a stale field the operator can see and fix"; nothing implemented the
seeing. ``AdvancementStatus.fieldIsStale`` is the seeing.
"""

from backend.db import crud
from backend.tests.helpers import record_heat_result
from backend.tests.test_late_racer import build, run_heats, start_round


def _status(client, race_id, round_id):
    response = client.post(
        "/graphql",
        json={
            "query": f"""
            {{
                advancementStatus(raceId: {race_id}, roundId: {round_id}) {{
                    fieldIsStale
                    alreadyAdvanced
                }}
            }}
            """
        },
    )
    payload = response.json()
    assert "errors" not in payload, payload
    return payload["data"]["advancementStatus"]


def _race_with_raced_final(db, client):
    _, race_id = build(db, racers=4, lane_count=2)
    prelim = start_round(db, race_id)
    final = crud.create_round(
        db,
        race_id=race_id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=2,
    )
    crud.generate_heats_for_round(db, final.id, num_placeholders=2)
    run_heats(client, db, race_id, prelim.id)  # cascade fills the final
    run_heats(client, db, race_id, final.id)
    return race_id, prelim, final


def _correct_a_prelim_time(db, client, race_id, prelim_id):
    """Re-record the prelims so the standings reverse outright.

    Every heat, with a time that falls as the racer id rises — the higher the
    id, the faster the car. `run_heats` handed every lane the same time by
    position, which left the whole field tied and made "did the correction
    move the field" depend on the PPC shuffle; a full reversal does not."""
    for heat in crud.get_heats(db, race_id, round_id=prelim_id):
        corrected = [
            {
                "lane": lane.lane,
                "racer_id": lane.racer_id,
                "time": 3.0 + (100 - lane.racer_id) / 100,
            }
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id is not None
        ]
        record_heat_result(client, heat.id, corrected)


def test_a_raced_final_is_not_stale_while_the_standings_stand(db, client):
    race_id, _prelim, final = _race_with_raced_final(db, client)

    assert _status(client, race_id, final.id)["fieldIsStale"] is False


def test_a_correction_after_the_final_marks_it_stale(db, client):
    race_id, prelim, final = _race_with_raced_final(db, client)

    _correct_a_prelim_time(db, client, race_id, prelim.id)

    status = _status(client, race_id, final.id)
    # The final was raced, so invalidation left it alone — and now the flag
    # says so instead of the round looking like any other completed one.
    assert status["alreadyAdvanced"] is True
    assert status["fieldIsStale"] is True


def test_an_unraced_final_is_refielded_not_flagged(db, client):
    """While nothing has been raced, invalidation fixes the field outright;
    the flag is for the case it deliberately will not touch."""
    _, race_id = build(db, racers=4, lane_count=2)
    prelim = start_round(db, race_id)
    final = crud.create_round(
        db,
        race_id=race_id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=2,
    )
    crud.generate_heats_for_round(db, final.id, num_placeholders=2)
    run_heats(client, db, race_id, prelim.id)

    _correct_a_prelim_time(db, client, race_id, prelim.id)

    assert _status(client, race_id, final.id)["fieldIsStale"] is False


def test_a_correction_that_does_not_move_the_field_does_not_flag(db, client):
    """Nudging a time without changing who qualifies is not staleness.

    The prelims are re-recorded with per-racer times first — `run_heats`
    hands every lane the same time by position, which leaves the whole field
    tied and *any* nudge re-breaking the tie. Real standings have gaps.
    """
    race_id, prelim, final = _race_with_raced_final(db, client)

    def record_all(extra: float) -> None:
        for heat in crud.get_heats(db, race_id, round_id=prelim.id):
            results = [
                {
                    "lane": lane.lane,
                    "racer_id": lane.racer_id,
                    "time": 3.0 + lane.racer_id + extra,
                }
                for lane in crud.heat_lanes_of(db, heat)
                if lane.racer_id is not None
            ]
            record_heat_result(client, heat.id, results)

    record_all(0.0)
    stale_after_rewrite = _status(client, race_id, final.id)["fieldIsStale"]

    record_all(0.01)  # everyone a hundredth slower: same order, same field

    assert _status(client, race_id, final.id)["fieldIsStale"] is stale_after_rewrite


def test_a_general_round_is_never_stale(db, client):
    _, race_id = build(db)
    round_obj = start_round(db, race_id)
    run_heats(client, db, race_id, round_obj.id)

    assert _status(client, race_id, round_obj.id)["fieldIsStale"] is False
