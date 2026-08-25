"""Ladderless elimination: lose N heats and you are out, last car standing wins.

The pure rules live in `domain/elimination.py`; the database half is the
ELIMINATION branch of `generate_heats_for_round` plus
`extend_elimination_round`, which the recorded-result cascade calls so the
schedule grows a wave at a time.
"""

import random

from backend.db import crud, models, schemas
from backend.domain import elimination
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource


def _lane(lane, racer_id, time=None, place=None, skipped=False):
    return lanes_module.Lane(
        lane=lane, racer_id=racer_id, time=time, place=place, skipped=skipped
    )


class TestLosses:
    def test_everyone_but_the_winner_loses_the_heat(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=3.2, place=2),
            _lane(3, 3, time=3.4, place=3),
        ]
        assert elimination.losses_by_racer([heat]) == {1: 0, 2: 1, 3: 1}

    def test_a_pending_heat_costs_nobody_anything(self):
        heat = [_lane(1, 1), _lane(2, 2)]
        assert elimination.losses_by_racer([heat]) == {1: 0, 2: 0}

    def test_a_skipped_lane_is_neither_a_win_nor_a_loss(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=3.2, place=2),
            _lane(3, 3, skipped=True),
        ]
        assert elimination.losses_by_racer([heat]) == {1: 0, 2: 1, 3: 0}

    def test_a_dnf_is_a_loss(self):
        # A recorded time of zero is a start with no finish; the timer
        # assigns it no place, and it certainly did not win.
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=0.0),
        ]
        assert elimination.losses_by_racer([heat]) == {1: 0, 2: 1}

    def test_without_places_the_fastest_time_wins(self):
        heat = [
            _lane(1, 1, time=3.4),
            _lane(2, 2, time=3.1),
        ]
        assert elimination.losses_by_racer([heat]) == {1: 1, 2: 0}


class TestTheWave:
    def test_cars_with_equal_losses_race_each_other(self):
        losses = {1: 0, 2: 0, 3: 0, 4: 0, 5: 1, 6: 1, 7: 1, 8: 1}
        wave = elimination.next_wave(losses, 3, 4, rng=random.Random(7))
        assert [sorted(heat) for heat in wave] == [[1, 2, 3, 4], [5, 6, 7, 8]]

    def test_an_eliminated_car_is_never_scheduled(self):
        losses = {1: 0, 2: 1, 3: 3, 4: 0}
        wave = elimination.next_wave(losses, 3, 4, rng=random.Random(7))
        assert sorted(racer for heat in wave for racer in heat) == [1, 2, 4]

    def test_nobody_races_alone(self):
        # Five cars on a four-lane track: the naive chunking leaves a solo
        # heat, which on a timer is a meaningless guaranteed win.
        losses = dict.fromkeys(range(1, 6), 0)
        wave = elimination.next_wave(losses, 3, 4, rng=random.Random(7))
        assert all(len(heat) >= 2 for heat in wave)
        assert sum(len(heat) for heat in wave) == 5

    def test_a_decided_race_schedules_nothing(self):
        assert elimination.next_wave({1: 0, 2: 3}, 3, 4, rng=random.Random(7)) == []

    def test_the_whole_race_terminates(self):
        # Play an entire event: racer 1 always wins, everyone else loses in
        # lane order. Whatever the shuffles do, the loop must end with one
        # car standing — every raced heat adds at least one loss.
        losses = dict.fromkeys(range(1, 10), 0)
        rng = random.Random(42)
        waves = 0
        while True:
            wave = elimination.next_wave(losses, 2, 4, rng=rng)
            if not wave:
                break
            waves += 1
            assert waves < 100
            for heat in wave:
                winner = min(heat)
                for racer in heat:
                    if racer != winner:
                        losses[racer] += 1
        assert elimination.is_decided(losses, 2)
        alive = [r for r, c in losses.items() if c < 2]
        assert alive == [1]


class TestStandings:
    def test_the_last_car_out_places_highest_among_the_eliminated(self):
        heats = [
            # Heat 0: 3 loses (first loss), 1 wins.
            [_lane(1, 1, place=1, time=3.0), _lane(2, 3, place=2, time=3.5)],
            # Heat 1: 3 loses again — out after heat 1.
            [_lane(1, 2, place=1, time=3.1), _lane(2, 3, place=2, time=3.6)],
            # Heat 2: 2 loses twice? No — 2 loses once here.
            [_lane(1, 1, place=1, time=3.0), _lane(2, 2, place=2, time=3.2)],
            # Heat 3: 2's second loss — out after heat 3, later than 3.
            [_lane(1, 1, place=1, time=3.0), _lane(2, 2, place=2, time=3.2)],
        ]
        standings = elimination.standings(heats, 2)
        assert [s.racer_id for s in standings] == [1, 2, 3]
        assert standings[0].alive
        assert not standings[1].alive
        assert standings[1].out_after == 3
        assert standings[2].out_after == 1


# --------------------------------------------------------------------------- #
# Against the database                                                        #
# --------------------------------------------------------------------------- #


def _race(db, name) -> models.Race:
    group = crud.create_group(db, schemas.GroupCreate(name=f"Pack for {name}"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            group_id=group.id,
            name=name,
            track_id=track.id,
            scoring_strategy=models.ScoringStrategy.TIMED,
        ),
    )


def _racers(db, race_id, count) -> list[int]:
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=f"Racer{n}",
                last_name="Elim",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(count)
    ]


def _elimination_round(db, name, racer_count=6, max_losses=2):
    race = _race(db, name)
    ids = _racers(db, race.id, racer_count)
    round_obj = crud.create_round(
        db,
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
        name="Elimination Round",
        elimination_losses=max_losses,
    )
    crud.generate_heats_for_round(db, round_obj.id)
    return race, ids, round_obj


def _pending_heats(db, round_id):
    heats = (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_id)
        .order_by(models.Heat.heat_number)
        .all()
    )
    return [h for h in heats if not lanes_module.is_finished(crud.heat_lanes_of(db, h))]


def _run_heat(db, heat, favourite_order):
    """Record a heat: the earlier a racer appears in the order, the better."""
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


class TestTheRound:
    def test_the_first_wave_fields_everyone_once(self, db):
        race, ids, round_obj = _elimination_round(db, "Elim Derby")

        heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        scheduled = [
            lane.racer_id
            for h in heats
            for lane in crud.heat_lanes_of(db, h)
            if lane.racer_id
        ]
        assert sorted(scheduled) == sorted(ids)
        assert len(heats) == 2

    def test_the_schedule_grows_until_one_car_stands(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Growing Elim Derby", racer_count=4, max_losses=2
        )

        # ids[0] wins everything; everyone else loses whenever they race.
        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)
        else:
            raise AssertionError("the elimination never finished")

        heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        losses = elimination.losses_by_racer(crud.lanes_for_heats(db, heats))
        assert elimination.is_decided(losses, 2)
        assert losses[ids[0]] == 0
        assert crud.is_round_complete(db, round_obj.id)

    def test_between_waves_the_round_is_not_complete(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Waving Elim Derby", racer_count=4, max_losses=2
        )
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        # Every scheduled heat is finished — but nobody has two losses, so a
        # naive completeness answer here would hand a championship round a
        # field from a race still going.
        assert not crud.is_round_complete(db, round_obj.id)
        assert _pending_heats(db, round_obj.id)

    def test_an_eliminated_car_races_no_more_heats(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Knockout Elim Derby", racer_count=4, max_losses=1
        )
        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)

        heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        parsed = crud.lanes_for_heats(db, heats)
        # Walk the schedule: once a racer has taken max_losses, they must not
        # appear in any later heat.
        losses = dict.fromkeys(ids, 0)
        for heat_lanes in parsed:
            for lane in heat_lanes:
                if lane.racer_id is not None:
                    assert losses[lane.racer_id] < 1, (
                        f"racer {lane.racer_id} raced while eliminated"
                    )
            for racer_id, count in elimination.losses_by_racer([heat_lanes]).items():
                losses[racer_id] += count

    def test_a_latecomer_joins_the_next_wave(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Latecomer Elim Derby", racer_count=4, max_losses=3
        )
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        late = crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                first_name="Late",
                last_name="Arrival",
                car_number=99,
                car_passed_inspection=True,
            ),
        )
        # Waves are append-only — the already-scheduled wave is never edited
        # underneath the operator (#50) — so the newcomer joins the wave
        # *after* the one already on the schedule.
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        pending = _pending_heats(db, round_obj.id)
        scheduled = {
            lane.racer_id
            for h in pending
            for lane in crud.heat_lanes_of(db, h)
            if lane.racer_id
        }
        assert late.id in scheduled

    def test_checking_in_after_the_final_heat_does_not_restart_the_race(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Decided Elim Derby", racer_count=4, max_losses=1
        )
        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)
        assert crud.is_round_complete(db, round_obj.id)

        crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race.id,
                first_name="Too",
                last_name="Late",
                car_number=98,
                car_passed_inspection=True,
            ),
        )
        # The cascade runs on every result; re-record the last heat so the
        # extension gets its chance — and declines it.
        heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        _run_heat(db, heats[-1], ids)

        assert not _pending_heats(db, round_obj.id)
        assert crud.is_round_complete(db, round_obj.id)

    def test_elimination_heats_stay_out_of_the_race_standings(self, db):
        from backend.services import scoring

        race, ids, round_obj = _elimination_round(
            db, "Excluded Elim Derby", racer_count=4, max_losses=2
        )
        prelim = crud.create_round(db, race_id=race.id, round_number=2)
        crud.generate_heats_for_round(db, prelim.id)

        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        # Only the (unraced) prelim counts, so nobody has a score yet — the
        # elimination heats that just ran must not leak in.
        board = scoring.get_leaderboard(db, race.id)
        assert all(entry["heats_completed"] == 0 for entry in board)

    def test_the_rounds_own_standings_read_survival(self, db):
        from backend.services import scoring

        race, ids, round_obj = _elimination_round(
            db, "Standings Elim Derby", racer_count=4, max_losses=1
        )
        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)

        board = scoring.get_leaderboard(db, race.id, round_id=round_obj.id)
        assert board[0]["racer_id"] == ids[0]
        assert board[0]["score"] == 0.0
        assert board[0]["rank"] == 1
        # Everyone else went out with exactly one loss; ties are visible.
        assert all(entry["score"] == 1.0 for entry in board[1:])
