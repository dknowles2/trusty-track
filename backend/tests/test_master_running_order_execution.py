"""The execution surfaces follow the master running order (#549).

Stage 2 wrote the interleave into ``Heat.heat_number`` and stage 3 repairs it
mid-event, but nothing in the execution flow *read* it back: the
``currentlyRacing`` / ``onDeck`` subscriptions sorted every race's heats by
``(round_number, heat_number)``, so even with the flag on and the interleave
applied, the audience displays walked one round's block to completion before
the next round's heats existed for them at all — the exact idling the feature
exists to end. ``crud.heats_in_running_order`` is now the one door both
subscriptions read through, and the rule itself is
``domain.running_order.execution_sort_key``.

Two consequences pinned here beyond the ordering itself:

* A championship round is exempt from the interleave and runs after every
  general round. Its field is drawn from the general rounds' standings, and
  the advancement cascade's ``_reset_heats_in_place`` renumbers its heats
  1..N on every rebuild — so ``apply_master_running_order`` leaves it alone
  and the sort places it last, whatever numbers it holds.
* With the flag off — every race that predates it — nothing changes, even in
  a race whose numbers have been interleaved.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import audit, lanes


@pytest.fixture
def race(db):
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Exec Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Exec Track", lane_count=4, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=org.id, name="Execution Order Derby", track_id=track.id
        ),
    )
    car = 1
    for i, count in enumerate([2, 3]):
        racing_group = crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(name=f"Den {i + 1}", color="#123456"),
            race.id,
        )
        for n in range(count):
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    race_id=race.id,
                    racing_group_id=racing_group.id,
                    first_name=f"Racer{i}-{n}",
                    last_name="Exec",
                    car_number=car,
                    car_passed_inspection=True,
                ),
            )
            car += 1
    return race


def _den_rounds(client, race_id, championship=False):
    """One general round per racing group, optionally with a final."""
    body = client.post(
        "/graphql",
        json={
            "query": """
                mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
                    createRoundWizard(raceId: $raceId, config: $config) {
                        id
                        roundNumber
                    }
                }
            """,
            "variables": {
                "raceId": race_id,
                "config": {
                    "generalRound": {"type": "EACH_GROUP", "runsPerLane": 1},
                    "championshipRounds": (
                        [
                            {
                                "name": "Finals",
                                "source": "ALL",
                                "numTopRacers": 3,
                                "runsPerLane": 1,
                            }
                        ]
                        if championship
                        else []
                    ),
                },
            },
        },
    ).json()
    assert "errors" not in body, body
    return body["data"]["createRoundWizard"]


def _turn_on(db, race_id):
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    race.master_running_order = True
    db.commit()


def _record(db, heat):
    raced = [
        lanes.Lane(
            lane=ln.lane, racer_id=ln.racer_id, time=3.0 + ln.lane / 10, place=ln.lane
        )
        for ln in crud.heat_lanes_of(db, heat)
        if ln.racer_id is not None
    ]
    crud.record_heat_result(db, heat.id, raced, source=audit.ResultSource.OPERATOR)


async def _first(db, name, race_id):
    """A subscription's opening value, which is the query under test."""
    from backend.api.schema import Subscription

    class MockInfo:
        context = {"db": db}

    generator = getattr(Subscription(), name)(MockInfo(), race_id)
    try:
        return await generator.__anext__()
    finally:
        await generator.aclose()


def test_with_the_flag_off_the_order_is_round_blocks(db, client, race):
    """Even in a race whose numbers *have* been interleaved: an operator who
    applies the order and then turns the flag back off gets the old blocks
    back, and every race that predates the flag is untouched by definition.
    """
    _den_rounds(client, race.id)
    crud.apply_master_running_order(db, race.id)

    ordered = crud.heats_in_running_order(db, race.id)
    round_sequence = [h.round.round_number for h in ordered]
    assert round_sequence == sorted(round_sequence), (
        "with master_running_order off, one round's block must finish before "
        "the next round's begins"
    )


def test_with_the_flag_on_the_order_is_the_interleave(db, client, race):
    _den_rounds(client, race.id)
    _turn_on(db, race.id)
    crud.apply_master_running_order(db, race.id)

    ordered = crud.heats_in_running_order(db, race.id)
    assert [h.heat_number for h in ordered] == sorted(h.heat_number for h in ordered)
    # It is genuinely an interleave, not a re-sorted block: the first two
    # heats to run come from different rounds, which is the whole wall-clock
    # win — the next den is queued while the current one races.
    assert ordered[0].round_id != ordered[1].round_id


@pytest.mark.anyio
async def test_the_audience_displays_follow_the_master_order(db, client, race):
    """Record the first heat of the master order; `currentlyRacing` must move
    to the *other round's* first heat — the interleave's next pick — rather
    than staying inside the recorded heat's round block, and `onDeck` must
    continue the same sequence.
    """
    _den_rounds(client, race.id)
    _turn_on(db, race.id)
    crud.apply_master_running_order(db, race.id)

    ordered = crud.heats_in_running_order(db, race.id)
    _record(db, ordered[0])

    current = await _first(db, "currently_racing", race.id)
    on_deck = await _first(db, "on_deck", race.id)

    assert current is not None
    assert current.id == ordered[1].id
    assert current.round_id != ordered[0].round_id
    assert [h.id for h in on_deck] == [ordered[2].id, ordered[3].id]


@pytest.mark.anyio
async def test_with_the_flag_off_the_displays_are_unchanged(db, client, race):
    """The mirror image: same race, same recorded heat, flag off — the
    displays stay inside the first round's block, exactly as before #549.
    """
    rounds = _den_rounds(client, race.id)
    first_round_heats = crud.get_heats(db, race.id, round_id=rounds[0]["id"])
    _record(db, first_round_heats[0])

    current = await _first(db, "currently_racing", race.id)

    assert current is not None
    assert current.id == first_round_heats[1].id


def test_apply_leaves_championship_rounds_alone(db, client, race):
    """The final's heats keep the numbers their own generator gave them and
    are not counted among the mutation's updates — a master number written
    onto one could not survive `_reset_heats_in_place` renumbering the round
    1..N on the next rebuild anyway.
    """
    rounds = _den_rounds(client, race.id, championship=True)
    final = next(r for r in rounds if r["roundNumber"] == 3)
    final_numbers_before = [
        h.heat_number for h in crud.get_heats(db, race.id, round_id=final["id"])
    ]
    general_pending = [
        h
        for h in crud.get_heats(db, race.id)
        if h.round_id != final["id"] and h.recorded_at is None
    ]

    updated = crud.apply_master_running_order(db, race.id)

    assert {h.id for h in updated} == {h.id for h in general_pending}
    db.expire_all()
    assert [
        h.heat_number for h in crud.get_heats(db, race.id, round_id=final["id"])
    ] == final_numbers_before


def test_championship_rounds_run_after_every_general_round(db, client, race):
    """Under the flag, the final's low per-round numbers must not put it at
    the head of the running order — it runs last, after both dens' interleaved
    heats, whatever numbers it holds.
    """
    rounds = _den_rounds(client, race.id, championship=True)
    final = next(r for r in rounds if r["roundNumber"] == 3)
    _turn_on(db, race.id)
    crud.apply_master_running_order(db, race.id)

    ordered = crud.heats_in_running_order(db, race.id)
    final_heat_count = len(crud.get_heats(db, race.id, round_id=final["id"]))
    assert final_heat_count > 0
    assert all(h.round_id == final["id"] for h in ordered[-final_heat_count:])
    assert all(h.round_id != final["id"] for h in ordered[:-final_heat_count])


def test_repair_never_renumbers_a_championship_round(db, client, race):
    """`repair_master_running_order` is handed exactly the heats a mid-event
    cascade just created; if that cascade rebuilt a championship round, those
    heats stay on their generator's own numbers, same as `apply`.
    """
    rounds = _den_rounds(client, race.id, championship=True)
    final = next(r for r in rounds if r["roundNumber"] == 3)
    _turn_on(db, race.id)

    final_heats = crud.get_heats(db, race.id, round_id=final["id"])
    numbers_before = [h.heat_number for h in final_heats]

    repaired = crud.repair_master_running_order(db, race.id, {final["id"]: final_heats})
    assert repaired == []
    db.expire_all()
    assert [
        h.heat_number for h in crud.get_heats(db, race.id, round_id=final["id"])
    ] == numbers_before
