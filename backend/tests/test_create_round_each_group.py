"""``createRound`` honouring "By {group}" (#1013, #1025).

The Add Round dialog has offered a **Format** picker — "All {org}" or "By
{group}" — for a while (`RoundConfigModal.tsx`, backed by
`RoundCreateInput.general_type`), and the dialog even counts the rounds it is
about to create ("Will create 2 rounds") and renames its own submit button
to **Add rounds**. None of that ever reached the backend: `Mutation.
create_round` declared `general_type` on its input and never read it, so
choosing "By {group}" silently built one mixed "All {org}" round instead of
one per racing group.

`createRoundWizard` had the per-group loop from the start — step 1 offers the
identical choice — so the fix is to give `createRound` the same one copy of
"one round per group" rather than a second copy of its own
(`crud.create_general_round`, #48's lesson). This is the seam #1025 asks for:
nothing in the suite had driven `createRound` and a multi-racing-group race
together before.
"""

from backend.db import crud, models, schemas


def _race_with_groups(db, name, group_racer_counts):
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{name} Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{name} Track", lane_count=4, timer_type="FAKE")
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
    car = 1
    for idx, count in enumerate(group_racer_counts):
        group = crud.create_racing_group(
            db,
            schemas.RacingGroupCreate(name=f"Den {idx + 1}", color="#123456"),
            race.id,
        )
        for n in range(count):
            crud.create_racer(
                db,
                schemas.RacerCreate(
                    race_id=race.id,
                    racing_group_id=group.id,
                    first_name=f"Racer{idx}-{n}",
                    last_name="ByDen",
                    car_number=car,
                    car_passed_inspection=True,
                ),
            )
            car += 1
    return race


CREATE_ROUND = """
mutation Add($raceId: Int!, $round: RoundCreateInput!) {
    createRound(raceId: $raceId, roundData: $round) {
        id
        roundNumber
        name
        racingGroupId
    }
}
"""


def _add_round(client, race_id, **fields):
    return client.post(
        "/graphql",
        json={
            "query": CREATE_ROUND,
            "variables": {"raceId": race_id, "round": fields},
        },
    ).json()


def test_by_den_creates_one_round_per_group_scoped_to_its_own_racers(db, client):
    race = _race_with_groups(db, "ByDenDerby", [2, 2])

    body = _add_round(
        client, race.id, name="Prelims", generalType="EACH_GROUP", runsPerLane=1
    )
    assert "errors" not in body, body

    rounds = body["data"]["createRound"]
    # Two rounds, not the one mixed round the bug produced.
    assert len(rounds) == 2
    assert [r["roundNumber"] for r in rounds] == [1, 2]
    assert all(r["racingGroupId"] is not None for r in rounds)
    assert {r["racingGroupId"] for r in rounds} == {
        g.id for g in crud.get_racing_groups(db, race.id)
    }

    # Each round's heats hold only that round's own racing group's racers —
    # the mixed-round bug put every racer, from every den, in the same
    # heats.
    db.expire_all()
    for r in rounds:
        round_obj = db.get(models.Round, r["id"])
        assert round_obj is not None
        group_racer_ids = {
            racer.id
            for racer in db.query(models.Racer).filter(
                models.Racer.racing_group_id == round_obj.racing_group_id
            )
        }
        assert group_racer_ids, "the round's own racing group should have racers"
        for heat_lanes in crud.lanes_for_heats(db, round_obj.heats):
            for lane in heat_lanes:
                if lane.racer_id is not None:
                    assert lane.racer_id in group_racer_ids


def test_a_den_with_nobody_in_it_gets_no_round(db, client):
    race = _race_with_groups(db, "EmptyDenAddRound", [2, 0, 2])

    body = _add_round(
        client, race.id, name="Prelims", generalType="EACH_GROUP", runsPerLane=1
    )
    assert "errors" not in body, body

    rounds = body["data"]["createRound"]
    assert len(rounds) == 2
    assert [r["roundNumber"] for r in rounds] == [1, 2]


def test_the_default_format_still_creates_one_round(db, client):
    """Belt and braces: an ordinary "All {org}" round is unaffected — the
    mutation's return type was already a list before #1013, and a caller
    reading `[0]` (as `RaceControl.tsx` already does, anticipating exactly
    this) must keep seeing exactly one round for the default format."""
    race = _race_with_groups(db, "AllPackAddRound", [2, 2])

    body = _add_round(client, race.id, name="Prelims", runsPerLane=1)
    assert "errors" not in body, body

    rounds = body["data"]["createRound"]
    assert len(rounds) == 1
    assert rounds[0]["racingGroupId"] is None


def test_a_den_with_nobody_checked_in_gets_no_round(db, client):
    """A den whose racers are all still on the roster but not yet inspected
    is exactly the "empty" case `create_general_round` already skips for a
    den with literally nobody in it — check-in is the eligibility gate
    everywhere else a schedule is built (CLAUDE.md's "A racer who arrives
    after the racing has started"), and this seam had nothing pinning that
    an EACH_GROUP round respects it too."""
    race = _race_with_groups(db, "UncheckedDenAddRound", [2, 0])

    # Den 2 gets two racers, neither checked in — `_race_with_groups` always
    # passes `car_passed_inspection=True`, so add these directly.
    group2 = crud.get_racing_groups(db, race.id)[1]
    for n in range(2):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                racing_group_id=group2.id,
                first_name=f"NotYet{n}",
                last_name="Inspected",
                car_number=100 + n,
                car_passed_inspection=False,
            ),
        )

    body = _add_round(
        client, race.id, name="Prelims", generalType="EACH_GROUP", runsPerLane=1
    )
    assert "errors" not in body, body

    rounds = body["data"]["createRound"]
    # Only Den 1 — Den 2 has racers on the roster but none checked in, so it
    # is treated the same as an empty den rather than getting a round with
    # nobody eligible to fill it.
    assert len(rounds) == 1
    assert rounds[0]["racingGroupId"] == crud.get_racing_groups(db, race.id)[0].id
