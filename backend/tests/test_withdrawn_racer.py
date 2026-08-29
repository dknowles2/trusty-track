"""A racer who leaves after the schedule was built (#228).

The mirror of #172, with the same three cases: a round nobody has raced is
regenerated without them, a round part-way through keeps every finished heat
and has their pending lanes vacated, a round already finished is untouched.

Withdrawal is recorded the way check-in is recorded — the desk un-checks
``car_passed_inspection`` — and until this existed the schedule simply never
heard about it: the racer stayed in every heat, their lanes raced empty, and
``get_advancing_racers`` would happily hand a championship slot to a car that
had left the building.
"""

from backend.db import crud, models, schemas
from backend.services import scoring
from backend.tests.test_late_racer import build, racers_in, run_heats, start_round


def withdraw(db, racer_id):
    """What the desk does: un-check the racer."""
    crud.update_racer(db, racer_id, schemas.RacerUpdate(car_passed_inspection=False))
    return racer_id


def first_racer(db, race_id):
    return (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id)
        .order_by(models.Racer.id)
        .first()
    )


class TestARoundNobodyHasRaced:
    def test_is_regenerated_without_them(self, db):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        gone = withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        assert gone not in racers_in(db, race_id, round_obj.id)

    def test_everybody_left_still_runs_every_lane_once(self, db):
        _, race_id = build(db, racers=5, lane_count=4)
        round_obj = start_round(db, race_id)
        withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        heats = crud.get_heats(db, race_id, round_id=round_obj.id)
        assert len(heats) == 4  # one per remaining racer
        appearances: dict[tuple[int, int], int] = {}
        for heat in heats:
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id is not None:
                    key = (lane.racer_id, lane.lane)
                    appearances[key] = appearances.get(key, 0) + 1
        assert set(appearances.values()) == {1}


class TestARoundPartWayThrough:
    def test_keeps_every_finished_heat(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        gone = withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        finished = crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        for heat in finished:
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id == gone:
                    assert lane.time is not None  # the result stands

    def test_vacates_their_pending_lanes(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        gone = withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        pending = crud.get_heats(db, race_id, round_id=round_obj.id)[2:]
        for heat in pending:
            for lane in crud.heat_lanes_of(db, heat):
                assert lane.racer_id != gone

    def test_does_not_mark_the_round_disrupted(self, db, client):
        """An absent car empties a lane; it does not give anybody extra runs,
        so the POINTS asymmetry the flag exists for does not arise."""
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        db.expire_all()
        assert not db.get(models.Round, round_obj.id).disrupted


class TestARoundAlreadyFinished:
    def test_is_left_alone(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id)
        gone = withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)

        assert gone in racers_in(db, race_id, round_obj.id)


class TestAdvancement:
    def _race_with_final(self, db, client):
        _, race_id = build(db, racers=4, lane_count=2)
        prelim = start_round(db, race_id)
        final = crud.create_round(
            db,
            race_id=race_id,
            round_number=2,
            advancement_source="ALL",
            advancement_num_racers=2,
        )
        crud.generate_heats_for_round(db, final.id, num_placeholders=2)
        run_heats(client, db, race_id, prelim.id)
        return race_id, final

    def test_a_withdrawn_racer_is_not_advanced(self, db, client):
        race_id, _final = self._race_with_final(db, client)
        top = scoring.get_advancing_racers(db, race_id, "ALL", 2)
        withdraw(db, top[0])

        after = scoring.get_advancing_racers(db, race_id, "ALL", 2)

        # The next qualifier steps up; the field stays full.
        assert top[0] not in after
        assert len(after) == 2

    def test_an_unraced_final_is_refielded(self, db, client):
        """The slot goes to the next qualifier, not to an empty lane."""
        race_id, final = self._race_with_final(db, client)
        # The cascade filled the final when the prelims completed.
        fielded = racers_in(db, race_id, final.id)
        assert fielded
        gone = withdraw(db, sorted(fielded)[0])

        crud.withdraw_absent_racers(db, race_id)

        refielded = racers_in(db, race_id, final.id)
        assert gone not in refielded
        assert len(refielded) == 2

    def test_a_raced_final_keeps_its_results(self, db, client):
        race_id, final = self._race_with_final(db, client)
        run_heats(client, db, race_id, final.id)
        fielded = racers_in(db, race_id, final.id)
        gone = withdraw(db, sorted(fielded)[0])

        crud.withdraw_absent_racers(db, race_id)

        assert gone in racers_in(db, race_id, final.id)


class TestTheHook:
    """Un-checking through the API reaches the schedule without further help."""

    def test_un_checking_via_graphql_updates_the_round(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        gone = first_racer(db, race_id).id

        client.post(
            "/graphql",
            json={
                "query": f"""
                mutation {{
                    checkInRacer(
                        id: {gone}, passedInspection: false, weight: null
                    ) {{ id }}
                }}
                """
            },
        )

        db.expire_all()
        assert gone not in racers_in(db, race_id, round_obj.id)

    def test_withdrawal_is_idempotent(self, db):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        withdraw(db, first_racer(db, race_id).id)

        crud.withdraw_absent_racers(db, race_id)
        first_pass = racers_in(db, race_id, round_obj.id)
        crud.withdraw_absent_racers(db, race_id)

        assert racers_in(db, race_id, round_obj.id) == first_pass

    def test_a_mistaken_un_check_heals_itself(self, db):
        """Withdraw, regret, re-check: admission puts them straight back."""
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        racer_id = first_racer(db, race_id).id
        withdraw(db, racer_id)
        crud.withdraw_absent_racers(db, race_id)
        assert racer_id not in racers_in(db, race_id, round_obj.id)

        crud.update_racer(db, racer_id, schemas.RacerUpdate(car_passed_inspection=True))
        crud.admit_late_racers(db, race_id)

        assert racer_id in racers_in(db, race_id, round_obj.id)


def test_too_few_racers_left_falls_back_to_vacating(db):
    """Two of three withdraw: no schedule is possible for one racer, so the
    withdrawn lanes are vacated rather than the regeneration raising at the
    check-in desk."""
    _, race_id = build(db, racers=3)
    round_obj = start_round(db, race_id)
    racers = (
        db.query(models.Racer)
        .filter(models.Racer.race_id == race_id)
        .order_by(models.Racer.id)
        .all()
    )
    withdraw(db, racers[0].id)
    withdraw(db, racers[1].id)

    crud.withdraw_absent_racers(db, race_id)

    remaining = racers_in(db, race_id, round_obj.id)
    assert racers[0].id not in remaining
    assert racers[1].id not in remaining


def test_the_docs_no_longer_recommend_the_skip_workaround(db, client):
    """#227 made skipping a heat score its racers as scratches under POINTS,
    so 'skip their heats' stopped being harmless advice for a withdrawal —
    the innocent co-occupants would be penalised. Withdrawal has to leave the
    others' pending heats intact instead, which is what this pins: after one
    racer withdraws mid-round, nobody else's lane is touched."""
    _, race_id = build(db)
    round_obj = start_round(db, race_id)
    run_heats(client, db, race_id, round_obj.id, count=2)
    gone = withdraw(db, first_racer(db, race_id).id)

    before = {
        heat.id: [
            (lane.lane, lane.racer_id)
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id is not None and lane.racer_id != gone
        ]
        for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
    }
    crud.withdraw_absent_racers(db, race_id)

    after = {
        heat.id: [
            (lane.lane, lane.racer_id)
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id is not None and lane.racer_id != gone
        ]
        for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
    }
    assert after == before
