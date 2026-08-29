import uuid

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.tests.helpers import as_lanes, lane_dicts


def _setup_race_with_heats(db, num_racers=3):
    """Setup a race with multiple racers and rounds."""
    suffix = str(uuid.uuid4())[:8]
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Regen Organization {suffix}")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"Regen Track {suffix}", lane_count=4)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Regen Race {suffix}", organization_id=group.id, track_id=track.id
        ),
    )

    racers = []
    for i in range(num_racers):
        r = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer {i}",
                last_name=suffix,
                car_number=100 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        racers.append(r)

    # Create regular round (unstarted)
    round_unstarted = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Unstarted Round"
    )
    crud.generate_heats_for_round(db, round_unstarted.id)

    # Create regular round (started)
    round_started = crud.create_round(
        db, race.id, 2, models.SchedulingStrategy.PPC, "Started Round"
    )
    crud.generate_heats_for_round(db, round_started.id)
    heat_started = (
        db.query(models.Heat).filter(models.Heat.round_id == round_started.id).first()
    )
    # Record a result for the first heat
    results_json = as_lanes(
        [{"lane": 1, "racer_id": racers[0].id, "time": 3.0, "place": 1}]
    )
    crud.record_heat_result(
        db, heat_started.id, results_json, source=audit.ResultSource.OPERATOR
    )

    # Create free race heat
    free_heat = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes(
            [
                {"lane": 1, "racer_id": racers[0].id},
                {"lane": 2, "racer_id": racers[1].id},
            ]
        ),
    )

    db.commit()
    return race.id, racers, round_unstarted.id, round_started.id, free_heat.id


def test_delete_racer_regenerates_unstarted_round(db):
    # With 3 racers and 4 lanes, PPC should generate 3 heats (12 slots, 12 assignments)
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Initial check
    initial_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == unstarted_id).all()
    )
    assert len(initial_heats) == 3

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Unstarted round should be REGENERATED
    # Now only 2 racers left. 2 racers * 4 lanes = 8 slots = 2 heats.
    heats_unstarted = (
        db.query(models.Heat).filter(models.Heat.round_id == unstarted_id).all()
    )
    assert len(heats_unstarted) == 2, "Should have regenerated to 2 heats"

    alice_found = False
    for h in heats_unstarted:
        results = lane_dicts(db, h)
        for lane in results:
            if lane.get("racer_id") == r1_id:
                alice_found = True

    assert not alice_found, "Deleted racer should be gone from regenerated heats"


def test_delete_racer_nullifies_started_round(db):
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Initial check
    initial_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == started_id).all()
    )
    assert len(initial_heats) == 3

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Started round should be NULLIFIED (leave hole), NOT regenerated
    heats_started = (
        db.query(models.Heat).filter(models.Heat.round_id == started_id).all()
    )
    assert len(heats_started) == 3, "Started round should NOT be regenerated"

    alice_found = False
    hole_found = False
    for h in heats_started:
        results = lane_dicts(db, h)
        for lane in results:
            if lane.get("racer_id") == r1_id:
                alice_found = True
            if lane.get("racer_id") is None:
                hole_found = True

    assert not alice_found, "Deleted racer should be removed"
    assert hole_found, "Hole should be left in started round"


def test_delete_racer_nullifies_free_heat(db):
    race_id, racers, unstarted_id, started_id, free_id = _setup_race_with_heats(
        db, num_racers=3
    )
    r1_id = racers[0].id

    # Delete Racer 0
    crud.delete_racer(db, r1_id)
    db.commit()

    # Free heat should be nullified
    free_heat = db.query(models.Heat).filter(models.Heat.id == free_id).first()
    assignments = lane_dicts(db, free_heat)
    assert assignments[0]["racer_id"] is None, (
        "Deleted racer should be nullified in free heat"
    )


# --- #310: bulk-deleting racers can fail half-way -------------------------
#
# `bulk_delete_racers` vacates lanes and deletes racers in their own commits,
# *then* regenerates the rounds `may_rebuild` says are safe to touch. For a
# general round, regeneration means asking the field for at least two
# eligible racers — and if the deletes just committed took the field below
# that, `generate_heats_for_round` raised `ValueError`. By then the racers
# were already gone: the operator saw a failed mutation for something that
# had already half-happened, and the round was left holding a stale
# schedule with holes vacated in it.
#
# `withdraw_absent_racers` hits the identical situation — checked-in count
# drops below two — and already has the right answer: skip regeneration and
# leave the vacated holes rather than raising. The tests below pin the same
# fallback for `bulk_delete_racers`.


def _setup_unraced_round(db, num_racers=3, lane_count=4):
    suffix = str(uuid.uuid4())[:8]
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Bulk Organization {suffix}")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"Bulk Track {suffix}", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Bulk Race {suffix}", organization_id=group.id, track_id=track.id
        ),
    )
    racers = []
    for i in range(num_racers):
        r = crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer {i}",
                last_name=suffix,
                car_number=200 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        racers.append(r)

    round_obj = crud.create_round(
        db, race.id, 1, models.SchedulingStrategy.PPC, "Round"
    )
    crud.generate_heats_for_round(db, round_obj.id)
    db.commit()
    return race.id, racers, round_obj.id


def _scheduled_racer_ids(db, round_id):
    scheduled = set()
    for heat in db.query(models.Heat).filter(models.Heat.round_id == round_id).all():
        for lane in lane_dicts(db, heat):
            if lane.get("racer_id") is not None:
                scheduled.add(lane["racer_id"])
    return scheduled


def test_bulk_delete_below_the_minimum_does_not_raise(db):
    """3 checked-in racers, an unraced round, delete 2 of them: the round
    cannot be rescheduled for a single racer, so `bulk_delete_racers` must
    not let `generate_heats_for_round`'s "not enough racers" error escape —
    the deletes it would be raising *after* are already committed."""
    race_id, racers, round_id = _setup_unraced_round(db, num_racers=3)
    doomed = [racers[0].id, racers[1].id]
    survivor = racers[2].id

    # No exception: the whole point of #310 is that this used to raise.
    crud.bulk_delete_racers(db, doomed)

    remaining = {r.id for r in db.query(models.Racer).filter_by(race_id=race_id)}
    assert remaining == {survivor}


def test_bulk_delete_below_the_minimum_leaves_the_survivor_scheduled(db):
    """Left with too few racers for a schedule, the round keeps the holes
    the vacating made rather than being torn down (or silently losing the
    survivor's own lane)."""
    race_id, racers, round_id = _setup_unraced_round(db, num_racers=3)
    doomed = [racers[0].id, racers[1].id]
    survivor = racers[2].id

    crud.bulk_delete_racers(db, doomed)

    db.expire_all()
    scheduled = _scheduled_racer_ids(db, round_id)
    assert survivor in scheduled
    assert not (scheduled & set(doomed))


def test_bulk_delete_one_of_two_also_falls_back(db):
    """The issue's other reproduction: `deleteRacer` on one of two
    checked-in racers is the same drop-below-two case."""
    race_id, racers, round_id = _setup_unraced_round(db, num_racers=2)
    survivor = racers[1].id

    crud.bulk_delete_racers(db, [racers[0].id])

    remaining = {r.id for r in db.query(models.Racer).filter_by(race_id=race_id)}
    assert remaining == {survivor}
    db.expire_all()
    assert survivor in _scheduled_racer_ids(db, round_id)


def test_bulk_delete_with_enough_racers_left_still_rebuilds(db):
    """The fallback is scoped to the shortage: deleting down to more than
    the minimum still regenerates a clean schedule rather than leaving
    holes unnecessarily."""
    race_id, racers, round_id = _setup_unraced_round(db, num_racers=4)
    doomed = racers[0].id
    remaining_ids = {r.id for r in racers[1:]}

    crud.bulk_delete_racers(db, [doomed])

    db.expire_all()
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    scheduled = _scheduled_racer_ids(db, round_id)
    assert scheduled == remaining_ids
    # A rebuilt round is one heat per remaining racer, none of them holes.
    assert len(heats) == len(remaining_ids)


def test_bulk_delete_via_graphql_mutation_does_not_error(db, client):
    """The GraphQL mutation the operator actually calls must not surface
    the ValueError either."""
    race_id, racers, round_id = _setup_unraced_round(db, num_racers=3)
    ids = [racers[0].id, racers[1].id]

    resp = client.post(
        "/graphql",
        json={"query": f"mutation {{ bulkDeleteRacers(racerIds: {ids}) }}"},
    )

    body = resp.json()
    assert "errors" not in body, body
    assert body["data"]["bulkDeleteRacers"] is True
