"""``applyMasterRunningOrder`` (#549, stage 2).

`domain/running_order.py` (stage 1) is pure and already holds the interleave
properties. What stage 2 adds is the wiring: a race-scoped mutation that
gathers each of a race's rounds' *pending* heats into a `GroupSchedule`,
interleaves them, and writes the result through `_write_heat_numbers` — the
same door `reorderHeats` already used. These tests are about that wiring, not
about the interleave algorithm itself, which `test_domain_running_order.py`
already covers on its own.
"""

from backend.db import crud, models, schemas
from backend.domain import audit, lanes, running_order

APPLY_MUTATION = """
mutation Apply($raceId: Int!) {
    applyMasterRunningOrder(raceId: $raceId) {
        updatedCount
        heats { id heatNumber roundId }
    }
}
"""


def _race(db, name, racing_group_sizes):
    """A race with one racing group per entry in ``racing_group_sizes``."""
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack for {name}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    race = crud.create_race(
        db, schemas.RaceCreate(organization_id=org.id, name=name, track_id=track.id)
    )
    car = 1
    for i, count in enumerate(racing_group_sizes):
        racing_group = crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(name=f"RacingGroup {i + 1}", color="#123456"),
            race.id,
        )
        for n in range(count):
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    race_id=race.id,
                    racing_group_id=racing_group.id,
                    first_name=f"Racer{i}-{n}",
                    last_name="Order",
                    car_number=car,
                    car_passed_inspection=True,
                ),
            )
            car += 1
    return race


def _den_wizard(client, race_id):
    return client.post(
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
                    "championshipRounds": [],
                },
            },
        },
    ).json()


def _turn_on_master_running_order(db, race_id):
    race = db.query(models.Race).filter(models.Race.id == race_id).one()
    race.master_running_order = True
    db.commit()
    return race


def _heats_of(db, round_id):
    return sorted(
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all(),
        key=lambda h: h.heat_number,
    )


def _record(db, heat):
    """Record a real result for ``heat`` through the ordinary door."""
    raced = [
        lanes.Lane(
            lane=ln.lane, racer_id=ln.racer_id, time=3.0 + ln.lane / 10, place=ln.lane
        )
        for ln in crud.heat_lanes_of(db, heat)
        if ln.racer_id is not None
    ]
    crud.record_heat_result(db, heat.id, raced, source=audit.ResultSource.OPERATOR)


def _independent_expected_order(db, race_id):
    """Recompute the interleave straight from `domain/running_order.py`,
    independently of `crud.apply_master_running_order`, over the *current*
    pending heats — so a test comparing the two catches a mistake in the
    wiring (wrong racer ids, wrong grouping, wrong zip order) rather than
    just re-asserting the same code path against itself.
    """
    all_heats = crud.get_heats(db, race_id)
    pending = [h for h in all_heats if h.recorded_at is None]
    heat_lanes = crud.lanes_for_heats(db, pending)

    groups: dict[int, list[running_order.HeatEntry[int]]] = {}
    for heat, hl in zip(pending, heat_lanes, strict=True):
        assert heat.round_id is not None
        groups.setdefault(heat.round_id, []).append(
            running_order.HeatEntry(
                handle=heat.id, racer_ids=frozenset(lanes.real_racer_ids(hl))
            )
        )
    schedules = [
        running_order.GroupSchedule(group_id=round_id, heats=entries)
        for round_id, entries in groups.items()
    ]
    return running_order.interleave(schedules)


def test_apply_master_running_order_end_to_end(db, client):
    """The mutation, driven through GraphQL, renumbers every pending heat and
    reports them back — the ordinary "does the whole path work" case.
    """
    race = _race(db, "Master Order Derby", [2, 5])
    body = _den_wizard(client, race.id)
    assert "errors" not in body, body

    all_heats_before = crud.get_heats(db, race.id)
    assert len(all_heats_before) == 7  # one heat per racer, two rounds

    resp = client.post(
        "/graphql", json={"query": APPLY_MUTATION, "variables": {"raceId": race.id}}
    )
    body = resp.json()
    assert "errors" not in body, body
    data = body["data"]["applyMasterRunningOrder"]

    assert data["updatedCount"] == 7
    assert len(data["heats"]) == 7

    # Every heat number is unique and the set of heat ids is unchanged —
    # this reorders, it does not create or destroy heats.
    numbers = [h["heatNumber"] for h in data["heats"]]
    assert sorted(numbers) == list(range(min(numbers), min(numbers) + 7))
    assert {int(float(h["id"])) for h in data["heats"]} == {
        h.id for h in all_heats_before
    }

    # Both racing groups' rounds are represented in the result — it is a
    # single interleaved order across rounds, not a no-op copy of one round.
    round_ids_seen = {h["roundId"] for h in data["heats"]}
    assert len(round_ids_seen) == 2


def test_recorded_heats_are_never_renumbered(db, client):
    """A heat that already holds a result keeps its `heatNumber` — the record
    of when it ran (`recorded_at`, #59) is untouched, and it must not be
    among the mutation's `updatedCount`.
    """
    race = _race(db, "Recorded Untouched Derby", [3, 4])
    body = _den_wizard(client, race.id)
    rounds = body["data"]["createRoundWizard"]
    assert len(rounds) == 2

    first_round_heats = _heats_of(db, rounds[0]["id"])
    recorded_heat = first_round_heats[0]
    original_number = recorded_heat.heat_number
    original_round_id = recorded_heat.round_id
    _record(db, recorded_heat)
    db.expire_all()

    recorded_heat = db.get(models.Heat, recorded_heat.id)
    assert recorded_heat.recorded_at is not None

    total_heats = len(crud.get_heats(db, race.id))
    pending_count = total_heats - 1

    resp = client.post(
        "/graphql", json={"query": APPLY_MUTATION, "variables": {"raceId": race.id}}
    )
    body = resp.json()
    assert "errors" not in body, body
    data = body["data"]["applyMasterRunningOrder"]

    assert data["updatedCount"] == pending_count
    updated_ids = {int(float(h["id"])) for h in data["heats"]}
    assert recorded_heat.id not in updated_ids

    db.expire_all()
    recorded_heat = db.get(models.Heat, recorded_heat.id)
    assert recorded_heat.heat_number == original_number
    assert recorded_heat.round_id == original_round_id


def test_ordering_matches_the_domain_module(db, client):
    """The order the mutation writes is exactly what
    `domain.running_order.interleave` computes from the same input — the
    wiring adds no reordering, filtering or transformation of its own beyond
    what the issue calls for (excluding recorded heats).
    """
    race = _race(db, "Domain-Matched Derby", [2, 6])
    body = _den_wizard(client, race.id)
    assert "errors" not in body, body

    expected_order = _independent_expected_order(db, race.id)
    assert expected_order  # the fixture actually has pending heats to order

    resp = client.post(
        "/graphql", json={"query": APPLY_MUTATION, "variables": {"raceId": race.id}}
    )
    body = resp.json()
    assert "errors" not in body, body
    data = body["data"]["applyMasterRunningOrder"]

    actual_order = [
        int(float(h["id"]))
        for h in sorted(data["heats"], key=lambda h: h["heatNumber"])
    ]
    assert actual_order == expected_order


def test_master_running_order_defaults_to_false(db, client):
    """The per-race setting is off by default — every race that existed
    before this column did, and every race created after it that does not
    ask for it, runs one block per racing group exactly as before.
    """
    race = _race(db, "Default Off Derby", [2])
    resp = client.post(
        "/graphql",
        json={
            "query": """
                query($raceId: Int!) {
                    race(raceId: $raceId) { masterRunningOrder }
                }
            """,
            "variables": {"raceId": race.id},
        },
    )
    body = resp.json()
    assert "errors" not in body, body
    assert body["data"]["race"]["masterRunningOrder"] is False


def test_update_race_sets_the_flag(db, client):
    race = _race(db, "Flag Toggle Derby", [2])
    resp = client.post(
        "/graphql",
        json={
            "query": """
                mutation($raceId: Int!) {
                    updateRace(id: $raceId, race: { masterRunningOrder: true }) {
                        masterRunningOrder
                    }
                }
            """,
            "variables": {"raceId": race.id},
        },
    )
    body = resp.json()
    assert "errors" not in body, body
    assert body["data"]["updateRace"]["masterRunningOrder"] is True


# --------------------------------------------------------------------------- #
# `delete_heat` against a real interleaved schedule                          #
# --------------------------------------------------------------------------- #
#
# `crud.delete_heat`'s own docstring states the rule: with
# `Race.master_running_order` on, deleting a pending heat leaves every other
# heat's number untouched rather than renumbering the round it belonged to —
# a renumber would silently pull a later heat earlier in the interleave, or
# push an earlier one later, contradicting a number an announcer (or another
# wall display) may already have read. `test_delete_heat.py` already pins
# that rule against three heats it constructs by hand, in one round, with
# hand-picked heat_numbers (10, 20, 30) — never against a schedule the
# interleave itself produced, spanning more than one round, which is what
# every `test_master_running_order*.py` file was missing (#777).


def test_deleting_a_pending_heat_under_master_running_order_leaves_the_rest_intact(
    db, client
):
    """Delete a heat from the middle of a real, two-round interleave. Every
    other heat — in both rounds — must keep exactly the number
    `applyMasterRunningOrder` gave it, and `crud.heats_in_running_order` (the
    one door the audience-facing subscriptions read through, #549) must still
    produce a valid ascending sequence with the deleted heat gone and nothing
    duplicated.
    """
    race = _race(db, "Delete Interleave Derby", [3, 3])
    _turn_on_master_running_order(db, race.id)
    body = _den_wizard(client, race.id)
    assert "errors" not in body, body

    resp = client.post(
        "/graphql", json={"query": APPLY_MUTATION, "variables": {"raceId": race.id}}
    )
    body = resp.json()
    assert "errors" not in body, body
    numbered = sorted(
        body["data"]["applyMasterRunningOrder"]["heats"], key=lambda h: h["heatNumber"]
    )
    assert len(numbered) == 6

    # A heat from the interior of the interleave — not the first or the
    # last — so a renumber that merely closed up one end would not be
    # caught by comparing against it alone.
    victim = numbered[2]
    victim_id = int(float(victim["id"]))
    before = {
        int(float(h["id"])): h["heatNumber"]
        for h in numbered
        if h["id"] != victim["id"]
    }

    assert crud.delete_heat(db, victim_id) is True

    remaining = crud.get_heats(db, race.id)
    after = {h.id: h.heat_number for h in remaining}
    assert after == before, (
        "deleting a heat under master running order must not renumber "
        "anything else, in its own round or the other one"
    )
    assert victim_id not in after

    ordered = crud.heats_in_running_order(db, race.id)
    assert [h.id for h in ordered] == sorted(after, key=lambda hid: after[hid])
    assert victim_id not in {h.id for h in ordered}


def test_deleting_a_pending_heat_with_the_flag_off_still_renumbers_its_own_round(
    db, client
):
    """The mirror image, through the same real two-round fixture rather than
    hand-built heats: with the flag off, deleting a pending heat renumbers
    only the *round it belonged to* — the other round's own numbering (which
    started at 1 independently, since nothing has interleaved them) is
    untouched.
    """
    race = _race(db, "Delete No Order Derby", [3, 3])
    body = _den_wizard(client, race.id)
    rounds = body["data"]["createRoundWizard"]
    assert len(rounds) == 2

    first_round_heats_before = _heats_of(db, rounds[0]["id"])
    second_round_heats_before = _heats_of(db, rounds[1]["id"])
    assert [h.heat_number for h in first_round_heats_before] == [1, 2, 3]
    assert [h.heat_number for h in second_round_heats_before] == [1, 2, 3]

    victim = first_round_heats_before[0]
    assert crud.delete_heat(db, victim.id) is True

    db.expire_all()
    first_round_heats_after = _heats_of(db, rounds[0]["id"])
    second_round_heats_after = _heats_of(db, rounds[1]["id"])
    assert [h.heat_number for h in first_round_heats_after] == [1, 2]
    # The other round never had the master order applied to it either, so
    # deleting a heat in the first round must not touch its numbering.
    assert [h.heat_number for h in second_round_heats_after] == [1, 2, 3]
    assert {h.id for h in second_round_heats_after} == {
        h.id for h in second_round_heats_before
    }


def test_repair_never_fills_a_gap_a_delete_left_behind(db, client):
    """scheduling.md is explicit that a physical insertion between two
    existing heat_number values is "not attempted" — new heats always land
    after the race's current highest number. A number a `delete_heat` call
    just freed up, in the middle of the sequence, is exactly the gap a
    "helpful" reuse would reach for; `repair_master_running_order` must skip
    over it rather than splice a new heat into it.
    """
    race = _race(db, "Freed Gap Derby", [3, 3])
    _turn_on_master_running_order(db, race.id)
    body = _den_wizard(client, race.id)
    rounds = body["data"]["createRoundWizard"]
    assert "errors" not in body, body

    resp = client.post(
        "/graphql", json={"query": APPLY_MUTATION, "variables": {"raceId": race.id}}
    )
    body = resp.json()
    assert "errors" not in body, body
    numbered = sorted(
        body["data"]["applyMasterRunningOrder"]["heats"], key=lambda h: h["heatNumber"]
    )
    assert len(numbered) == 6

    # Free up a number in the *middle* of the sequence, not the top of it —
    # freeing the highest number would make "the next number is above the
    # old max" true by coincidence, since that is also simply the next
    # integer. A middle gap is the case that actually tests "never spliced
    # in", as opposed to "simply incremented".
    victim = numbered[2]
    freed_number = victim["heatNumber"]
    assert crud.delete_heat(db, int(float(victim["id"]))) is True

    current_max = max(h.heat_number for h in crud.get_heats(db, race.id))
    assert freed_number < current_max, "the freed number must actually be a gap"

    # Manufacture a heat the way a mid-event cascade would hand one to this
    # function — a brand-new row for one of the race's own general rounds,
    # numbered the way a freshly generated round-local wave always is.
    round_id = rounds[0]["id"]
    new_heat = models.Heat(race_id=race.id, round_id=round_id, heat_number=1)
    db.add(new_heat)
    db.flush()
    crud.set_heat_lanes(new_heat, [lanes.Lane(lane=1, racer_id=None)])
    db.commit()

    repaired = crud.repair_master_running_order(db, race.id, {round_id: [new_heat]})

    assert len(repaired) == 1
    assert repaired[0].heat_number != freed_number
    assert repaired[0].heat_number > current_max, (
        "a freed gap must never be filled — new numbers only ever land "
        "above the race's current highest"
    )
