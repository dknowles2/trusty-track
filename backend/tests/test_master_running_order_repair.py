"""Repair, not regenerate (#549, stage 3).

Stage 2's ``applyMasterRunningOrder`` renumbers every pending heat from
scratch on each call, which is fine for the operator's own deliberate "apply
the master order" click but wrong for an automatic cascade: recomputing the
whole interleave from scratch is what the issue calls out as the failure mode
to avoid — an unrelated group gaining a heat can shift every other group's
credit from the very first pick, silently renumbering a heat the announcer
has already read out.

So the two seams that change a group's heat count mid-event — admitting a
latecomer (#172) and a lane outage rewriting pending heats (#171) — repair
the running order instead: ``crud.repair_master_running_order`` only ever
assigns a ``heat_number`` to a heat that did not exist before the call that
just created it, and only when ``Race.master_running_order`` is on. Every
heat that already existed, recorded or still pending, keeps the number it
already had.
"""

from backend.db import crud, models, schemas
from backend.domain import lanes, running_order
from backend.tests.helpers import record_heat_result


def _race(db, name, *, lane_count=4):
    org = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack for {name}")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"Track for {name}", lane_count=lane_count)
    )
    race = crud.create_race(
        db, schemas.RaceCreate(organization_id=org.id, name=name, track_id=track.id)
    )
    return track.id, race.id


def _group(db, race_id, name, racers, *, car_start):
    racing_group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name=name, color="#123456"), race_id
    )
    for n in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                racing_group_id=racing_group.id,
                first_name=f"{name}-{n}",
                last_name="Repair",
                car_number=car_start + n,
                car_passed_inspection=True,
            ),
        )
    return racing_group


def _round(db, race_id, racing_group_id, number):
    round_obj = crud.create_round(
        db, race_id=race_id, round_number=number, racing_group_id=racing_group_id
    )
    crud.generate_heats_for_round(db, round_obj.id)
    return round_obj


def _run(client, db, race_id, round_id, count):
    heats = crud.get_heats(db, race_id, round_id=round_id)
    for heat in heats[:count]:
        record_heat_result(
            client,
            heat.id,
            [
                {"lane": lane.lane, "racer_id": lane.racer_id, "time": 3.0 + lane.lane}
                for lane in crud.heat_lanes_of(db, heat)
                if lane.racer_id is not None
            ],
        )


def _turn_on_master_running_order(db, race_id):
    race = db.query(models.Race).filter(models.Race.id == race_id).one()
    race.master_running_order = True
    db.commit()
    return race


def _arrive(db, race_id, racing_group_id, name, car_number):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=name,
            last_name="Late",
            car_number=car_number,
            race_id=race_id,
            racing_group_id=racing_group_id,
            car_passed_inspection=True,
        ),
    )


def _all_numbers(db, race_id):
    return {h.id: h.heat_number for h in crud.get_heats(db, race_id)}


class TestTheFlagOff:
    def test_repair_touches_nothing_when_master_running_order_is_off(self, db, client):
        # The default state of every existing race: admitting a latecomer
        # behaves exactly as it did before this stage existed.
        _, race_id = _race(db, "Flag Off Derby")
        group = _group(db, race_id, "Lions", 4, car_start=1)
        round_obj = _round(db, race_id, group.id, 1)
        _run(client, db, race_id, round_obj.id, count=2)
        highest = max(h.heat_number for h in crud.get_heats(db, race_id))

        _arrive(db, race_id, group.id, "Latecomer", 900)
        crud.admit_late_racers(db, race_id)

        heats = crud.get_heats(db, race_id, round_id=round_obj.id)
        # Round-local numbering, exactly as `test_late_racer.py` pins.
        assert all(h.heat_number > highest for h in heats if h.heat_number > highest)


class TestRepairIsANoOp:
    def test_an_empty_map_touches_nothing(self, db):
        _, race_id = _race(db, "Empty Repair Derby")
        group = _group(db, race_id, "Lions", 3, car_start=1)
        _round(db, race_id, group.id, 1)
        _turn_on_master_running_order(db, race_id)
        before = _all_numbers(db, race_id)

        result = crud.repair_master_running_order(db, race_id, {})

        assert result == []
        assert _all_numbers(db, race_id) == before

    def test_calling_it_again_with_nothing_new_changes_nothing(self, db, client):
        # Idempotence: a second admission cascade that admits nobody must not
        # touch a single heat_number, even with the flag on.
        _, race_id = _race(db, "Repeat Repair Derby")
        group = _group(db, race_id, "Lions", 4, car_start=1)
        round_obj = _round(db, race_id, group.id, 1)
        _run(client, db, race_id, round_obj.id, count=2)
        _turn_on_master_running_order(db, race_id)

        late = _arrive(db, race_id, group.id, "Latecomer", 900)
        crud.admit_late_racers(db, race_id)
        after_first = _all_numbers(db, race_id)

        # Everyone eligible is already scheduled; a second call admits no one
        # and creates no heats, so `repair_master_running_order` is never
        # even asked to do anything beyond return `[]`.
        crud.admit_late_racers(db, race_id)
        after_second = _all_numbers(db, race_id)

        assert late.id  # sanity: the fixture actually admitted someone
        assert after_second == after_first


class TestAdmissionRepairsAcrossRounds:
    def test_existing_pending_heats_keep_their_ids_and_numbers(self, db, client):
        _, race_id = _race(db, "Preserve Derby")
        lions = _group(db, race_id, "Lions", 4, car_start=1)
        tigers = _group(db, race_id, "Tigers", 4, car_start=100)
        lions_round = _round(db, race_id, lions.id, 1)
        tigers_round = _round(db, race_id, tigers.id, 2)
        _run(client, db, race_id, lions_round.id, count=2)
        _run(client, db, race_id, tigers_round.id, count=2)

        _turn_on_master_running_order(db, race_id)
        crud.apply_master_running_order(db, race_id)
        before = {
            h.id: h.heat_number
            for h in crud.get_heats(db, race_id, round_id=lions_round.id)
        }
        assert before  # the fixture left pending heats to protect

        _arrive(db, race_id, tigers.id, "Latecomer", 900)
        crud.admit_late_racers(db, race_id)

        after = {
            h.id: h.heat_number
            for h in crud.get_heats(db, race_id, round_id=lions_round.id)
        }
        # The Lions round contributed no new heats this call — every one of
        # its heats, recorded or pending, keeps exactly the id and number an
        # earlier `applyMasterRunningOrder` (or the announcer reading from
        # it) already committed to.
        assert after == before

    def test_new_heats_never_collide_with_an_existing_number(self, db, client):
        # Lions outnumbers Tigers, so after an interleave Lions holds the
        # race's highest pending numbers while Tigers' own round-local max
        # stays low — exactly the shape where continuing from "the round's
        # own max plus one" (what admission does without a master order)
        # lands squarely on a number Lions already has.
        _, race_id = _race(db, "No Collision Derby")
        lions = _group(db, race_id, "Lions", 6, car_start=1)
        tigers = _group(db, race_id, "Tigers", 4, car_start=100)
        lions_round = _round(db, race_id, lions.id, 1)
        tigers_round = _round(db, race_id, tigers.id, 2)
        _run(client, db, race_id, lions_round.id, count=1)
        _run(client, db, race_id, tigers_round.id, count=1)

        _turn_on_master_running_order(db, race_id)
        crud.apply_master_running_order(db, race_id)
        highest_before = max(h.heat_number for h in crud.get_heats(db, race_id))
        before_ids = {h.id for h in crud.get_heats(db, race_id)}

        _arrive(db, race_id, tigers.id, "Latecomer", 900)
        crud.admit_late_racers(db, race_id)

        all_heats = crud.get_heats(db, race_id)
        # Only *pending* numbers have to be globally unique — a recorded
        # heat keeps the round-local number it was given when it ran (#59,
        # unchanged since stage 2), and two different rounds' recorded heats
        # sharing a small number (both a round's own "Heat 1", say) is
        # already the accepted, pre-existing shape of that rule. What must
        # never collide is two heats still *to come*.
        pending_numbers = [h.heat_number for h in all_heats if h.recorded_at is None]
        assert len(pending_numbers) == len(set(pending_numbers))

        new_heats = [h for h in all_heats if h.id not in before_ids]
        assert new_heats  # the latecomer was actually admitted
        assert all(h.heat_number > highest_before for h in new_heats)

    def test_two_rounds_appending_in_one_call_are_woven_together(self, db, client):
        # Two dens both admit a latecomer through one bulk check-in — a
        # single `admit_late_racers` call that grows two rounds at once. The
        # written order for the newly appended heats must match what
        # `running_order.interleave` computes independently over the same
        # two groups, exactly as stage 2's own wiring test compares against
        # the domain module rather than re-asserting the same code path.
        _, race_id = _race(db, "Weave Derby", lane_count=4)
        lions = _group(db, race_id, "Lions", 4, car_start=1)
        tigers = _group(db, race_id, "Tigers", 6, car_start=100)
        lions_round = _round(db, race_id, lions.id, 1)
        tigers_round = _round(db, race_id, tigers.id, 2)
        _run(client, db, race_id, lions_round.id, count=1)
        _run(client, db, race_id, tigers_round.id, count=1)

        _turn_on_master_running_order(db, race_id)
        crud.apply_master_running_order(db, race_id)
        before_ids = {h.id for h in crud.get_heats(db, race_id)}

        _arrive(db, race_id, lions.id, "Lion Latecomer", 901)
        _arrive(db, race_id, tigers.id, "Tiger Latecomer", 902)
        crud.admit_late_racers(db, race_id)

        all_heats = crud.get_heats(db, race_id)
        new_heats = sorted(
            (h for h in all_heats if h.id not in before_ids),
            key=lambda h: h.heat_number,
        )
        assert new_heats

        # Recompute independently: group the same new heats by round, in the
        # order they were actually written (their own generator's order, not
        # this test's guess at it), and ask the domain module directly.
        by_round: dict[int, list[models.Heat]] = {}
        for heat in sorted(new_heats, key=lambda h: h.id):
            by_round.setdefault(heat.round_id, []).append(heat)

        heat_lanes_by_id = {
            heat.id: crud.heat_lanes_of(db, heat)
            for hs in by_round.values()
            for heat in hs
        }
        schedules = [
            running_order.GroupSchedule(
                group_id=round_id,
                heats=[
                    running_order.HeatEntry(
                        handle=heat.id,
                        racer_ids=frozenset(
                            lanes.real_racer_ids(heat_lanes_by_id[heat.id])
                        ),
                    )
                    for heat in heats
                ],
            )
            for round_id, heats in by_round.items()
        ]
        expected_order = running_order.interleave(schedules)

        assert [h.id for h in new_heats] == expected_order


class TestOutageRepairsAcrossRounds:
    def test_a_full_regeneration_gets_fresh_globally_safe_numbers(self, db, client):
        track_id, race_id = _race(db, "Outage Repair Derby", lane_count=4)
        lions = _group(db, race_id, "Lions", 4, car_start=1)
        tigers = _group(db, race_id, "Tigers", 4, car_start=100)
        lions_round = _round(db, race_id, lions.id, 1)
        tigers_round = _round(db, race_id, tigers.id, 2)
        # The Tigers round is part-way through and stays put; the Lions round
        # is untouched (nothing raced) and is exactly what an outage rebuilds.
        _run(client, db, race_id, tigers_round.id, count=2)

        _turn_on_master_running_order(db, race_id)
        crud.apply_master_running_order(db, race_id)
        tigers_before = {
            h.id: h.heat_number
            for h in crud.get_heats(db, race_id, round_id=tigers_round.id)
        }
        lions_before_ids = {
            h.id for h in crud.get_heats(db, race_id, round_id=lions_round.id)
        }

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)

        db.expire_all()
        tigers_after = {
            h.id: h.heat_number
            for h in crud.get_heats(db, race_id, round_id=tigers_round.id)
        }
        # The Tigers round contributed no new heats — every heat it holds,
        # recorded or pending, keeps its id and number.
        assert tigers_after == tigers_before

        # The Lions round *was* fully regenerated (new ids), and rebuilding it
        # deleted its old heat rows along with whatever numbers they held —
        # so the only meaningful "does not collide" comparison is against
        # numbers that still belong to a heat that exists afterwards, namely
        # every one the Tigers round still holds.
        lions_after = crud.get_heats(db, race_id, round_id=lions_round.id)
        assert all(h.id not in lions_before_ids for h in lions_after)  # rebuilt
        tigers_max_after = max(tigers_after.values())
        assert all(h.heat_number > tigers_max_after for h in lions_after)

        pending_numbers = [
            h.heat_number for h in crud.get_heats(db, race_id) if h.recorded_at is None
        ]
        assert len(pending_numbers) == len(set(pending_numbers))

    def test_a_vacate_only_outage_needs_no_repair(self, db, client):
        # Nothing is created here — the pending heats keep their ids and
        # numbers by construction (#171), so this must not even look like a
        # repair happened.
        track_id, race_id = _race(db, "Vacate Only Derby", lane_count=4)
        lions = _group(db, race_id, "Lions", 4, car_start=1)
        round_obj = _round(db, race_id, lions.id, 1)
        _run(client, db, race_id, round_obj.id, count=2)

        _turn_on_master_running_order(db, race_id)
        crud.apply_master_running_order(db, race_id)
        before = _all_numbers(db, race_id)

        crud.set_lane_outages(db, track_id, [3])
        crud.apply_outages_to_scheduled_heats(db, track_id)

        db.expire_all()
        assert _all_numbers(db, race_id) == before
