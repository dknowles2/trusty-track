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

    def test_next_wave_heat_size_under_two_returns_empty(self):
        assert elimination.next_wave({1: 0, 2: 0}, 1, heat_size=1) == []

    def test_next_wave_heat_size_two_odd_racers_no_intermediate_solo_heat(self):
        losses = dict.fromkeys(range(1, 6), 0)
        wave = elimination.next_wave(losses, 1, heat_size=2, rng=random.Random(1))
        # Intermediate heats must not be left as a 1-car heat
        # while borrowing left another heat with 2 cars.
        assert all(len(h) == 2 for h in wave[:-1])
        assert all(len(h) > 0 for h in wave)

    def test_tail_rebalancing_property(self):
        for heat_size in range(1, 6):
            for n in range(2, 16):
                losses = dict.fromkeys(range(1, n + 1), 0)
                wave = elimination.next_wave(losses, 1, heat_size=heat_size)
                if heat_size < 2:
                    assert wave == []
                elif heat_size >= 3:
                    assert all(len(h) >= 2 for h in wave)
                else:
                    assert all(len(h) == 2 for h in wave[:-1])
                    assert all(len(h) > 0 for h in wave)

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
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"Pack for {name}")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            organization_id=group.id,
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

    def test_an_all_elimination_race_has_no_aggregate_standings(self, db):
        """The PRELIM fallback ("no prelim rounds — use every heat") must not
        resurrect elimination heats: their heat counts are uneven by design,
        and an average over them rewards being knocked out early."""
        from backend.services import scoring

        race, ids, round_obj = _elimination_round(
            db, "Only Elim Derby", racer_count=4, max_losses=1
        )
        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)

        board = scoring.get_leaderboard(db, race.id)
        assert all(entry["heats_completed"] == 0 for entry in board)

    def test_a_deleted_pending_wave_does_not_complete_the_round(self, db):
        """`is_round_complete` must ask whether a winner exists, not just
        whether every scheduled heat is finished. The one way to reach "all
        finished, nobody decided, nothing pending" is the operator deleting
        the pending wave — and a championship round downstream must not
        fill itself from a race in that state."""
        race, ids, round_obj = _elimination_round(
            db, "Deleted Wave Elim Derby", racer_count=4, max_losses=2
        )
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)
        pending = _pending_heats(db, round_obj.id)
        assert pending
        for heat in pending:
            crud.delete_heat(db, heat.id)

        assert not crud.is_round_complete(db, round_obj.id)

    def test_a_final_can_chain_off_the_elimination(self, db):
        """`ROUND:<elimination>` reads the survival leaderboard, so "the last
        two cars standing race a timed final" is expressible with the
        existing advancement machinery."""
        race, ids, round_obj = _elimination_round(
            db, "Chained Elim Derby", racer_count=4, max_losses=1
        )
        final = crud.create_round(
            db,
            race_id=race.id,
            round_number=2,
            advancement_source=f"ROUND:{round_obj.id}",
            advancement_num_racers=2,
        )
        crud.generate_heats_for_round(db, final.id, num_placeholders=2)

        for _ in range(20):
            pending = _pending_heats(db, round_obj.id)
            if not pending:
                break
            for heat in pending:
                _run_heat(db, heat, ids)

        db.expire_all()
        field = {
            lane.racer_id
            for heat in db.query(models.Heat)
            .filter(models.Heat.round_id == final.id)
            .all()
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id
        }
        # The winner, plus whoever survived longest of the eliminated.
        assert ids[0] in field
        assert len(field) == 2

    def test_the_resolver_creates_and_reports_an_elimination_round(self, db, client):
        race = _race(db, "Resolver Elim Derby")
        _racers(db, race.id, 5)

        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
                    createRound(raceId: $raceId, roundData: $roundData) {
                        id name schedulingStrategy eliminationLosses
                    }
                }
                """,
                "variables": {
                    "raceId": race.id,
                    "roundData": {"schedulingStrategy": "ELIMINATION"},
                },
            },
        ).json()
        assert "errors" not in body, body
        (made,) = body["data"]["createRound"]
        assert made["name"] == "Elimination Round"
        assert made["schedulingStrategy"] == "ELIMINATION"
        # Unspecified, so the default: three losses and you are out.
        assert made["eliminationLosses"] == 3

        db.expire_all()
        heats = db.query(models.Heat).filter(models.Heat.round_id == made["id"]).all()
        assert heats, "the first wave should be scheduled at creation"

    def test_an_elimination_championship_round_is_refused(self, db, client):
        race = _race(db, "Refused Elim Derby")
        _racers(db, race.id, 5)

        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
                    createRound(raceId: $raceId, roundData: $roundData) { id }
                }
                """,
                "variables": {
                    "raceId": race.id,
                    "roundData": {
                        "schedulingStrategy": "ELIMINATION",
                        "advancementSource": "ALL",
                        "advancementNumRacers": 3,
                    },
                },
            },
        ).json()
        assert "errors" in body
        db.expire_all()
        assert (
            db.query(models.Round).filter(models.Round.race_id == race.id).count() == 0
        )

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


class TestAWithdrawnCarThatNeverRaced:
    """#313: a car whose lanes are always skipped never loses, so it stays
    "alive" at zero losses forever. Un-checking it is the operator's only
    escape — and the round must actually reach a decision afterwards, both
    for `is_round_complete` and for the round's own leaderboard."""

    def test_the_round_completes_once_the_car_is_withdrawn(self, db):
        race, ids, round_obj = _elimination_round(
            db, "Withdrawal Elim Derby", racer_count=2, max_losses=1
        )
        winner, broken = ids

        def run(heat):
            stored = crud.heat_lanes_of(db, heat)
            recorded = [
                lanes_module.Lane(lane=lane.lane, racer_id=broken, skipped=True)
                if lane.racer_id == broken
                else lanes_module.Lane(
                    lane=lane.lane, racer_id=winner, time=3.0, place=1
                )
                if lane.racer_id == winner
                else lane
                for lane in stored
            ]
            crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)

        # Wave one: the winner races for real; the broken car's lane is
        # skipped. Neither loses — a skip is not a loss, and a lone finisher
        # has nobody to beat — so the cascade re-fields both for wave two.
        (heat,) = _pending_heats(db, round_obj.id)
        run(heat)
        assert not crud.is_round_complete(db, round_obj.id)

        # The operator's escape: un-check the broken car. Its lane in the
        # still-pending wave-two heat is vacated; the finished wave-one heat
        # is left as history, skipped lane and all.
        crud.update_racer(db, broken, schemas.RacerUpdate(car_passed_inspection=False))
        crud.withdraw_absent_racers(db, race.id)

        # The winner races the now-solo wave-two heat to close it out.
        (heat,) = _pending_heats(db, round_obj.id)
        run(heat)

        # Every heat is finished, and the withdrawn car must not keep the
        # round "not decided" on the strength of a skipped lane it can never
        # be checked back into.
        assert crud.is_round_complete(db, round_obj.id)

    def test_the_leaderboard_does_not_tie_it_with_the_winner(self, db):
        from backend.services import scoring

        race, ids, round_obj = _elimination_round(
            db, "Withdrawal Leaderboard Elim Derby", racer_count=2, max_losses=1
        )
        winner, broken = ids

        (heat,) = _pending_heats(db, round_obj.id)
        stored = crud.heat_lanes_of(db, heat)
        recorded = [
            lanes_module.Lane(lane=lane.lane, racer_id=broken, skipped=True)
            if lane.racer_id == broken
            else lanes_module.Lane(lane=lane.lane, racer_id=winner, time=3.0, place=1)
            for lane in stored
        ]
        crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)

        crud.update_racer(db, broken, schemas.RacerUpdate(car_passed_inspection=False))
        crud.withdraw_absent_racers(db, race.id)

        board = scoring.get_leaderboard(db, race.id, round_id=round_obj.id)
        # A withdrawn car with nothing but a skipped lane must not rank
        # alongside — let alone tie with — the car that actually raced.
        assert [entry["racer_id"] for entry in board] == [winner]
        assert board[0]["rank"] == 1


class TestTheChart:
    """The record of the round so far, wave by wave (#710).

    A bracket predicts; this format refuses to. The chart draws only what has
    happened, and every mark on it comes from the same loss rule that grows
    the next wave.
    """

    def test_a_new_wave_starts_when_a_car_reappears(self):
        wave_one = [
            [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=3.2, place=2)],
            [_lane(1, 3, time=3.0, place=1), _lane(2, 4, time=3.2, place=2)],
        ]
        wave_two = [
            [_lane(1, 1, time=3.0, place=1), _lane(2, 3, time=3.2, place=2)],
            [_lane(1, 2, time=3.0, place=1), _lane(2, 4, time=3.2, place=2)],
        ]
        assert elimination.waves_of(wave_one + wave_two) == [[0, 1], [2, 3]]

    def test_a_heat_holding_nobody_stays_with_the_wave_before_it(self):
        # Every lane vacated by a deleted racer: it belongs to the wave it
        # was drawn in, and must not start a new one.
        heats = [
            [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=3.2, place=2)],
            [_lane(1, None), _lane(2, None)],
            [_lane(1, 1), _lane(2, 2)],
        ]
        assert elimination.waves_of(heats) == [[0, 1], [2]]

    def test_no_heats_is_no_waves(self):
        assert elimination.waves_of([]) == []
        assert elimination.chart([], 2) == []

    def test_the_winner_and_the_losers_are_marked(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=3.2, place=2),
            _lane(3, 3, time=3.4, place=3),
        ]
        [wave] = elimination.chart([heat], 2)
        assert wave.number == 1
        [drawn] = wave.heats
        assert drawn.finished
        assert [lane.outcome for lane in drawn.lanes] == ["WON", "LOST", "LOST"]
        assert [lane.losses_after for lane in drawn.lanes] == [0, 1, 1]
        assert not any(lane.out for lane in drawn.lanes)

    def test_losses_accumulate_and_a_car_goes_out_at_the_limit(self):
        heats = [
            [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=3.2, place=2)],
            [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=3.2, place=2)],
        ]
        [_, wave_two] = elimination.chart(heats, 2)
        [drawn] = wave_two.heats
        loser = drawn.lanes[1]
        assert loser.racer_id == 2
        assert loser.losses_after == 2
        assert loser.out
        assert not drawn.lanes[0].out

    def test_a_pending_wave_is_drawn_with_no_outcome_and_the_losses_so_far(self):
        heats = [
            [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=3.2, place=2)],
            [_lane(1, 1), _lane(2, 2)],
        ]
        [_, pending] = elimination.chart(heats, 3)
        [drawn] = pending.heats
        assert not drawn.finished
        assert [lane.outcome for lane in drawn.lanes] == [None, None]
        assert [lane.losses_after for lane in drawn.lanes] == [0, 1]

    def test_a_skipped_lane_is_marked_skipped_and_costs_nothing(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=3.2, place=2),
            _lane(3, 3, skipped=True),
        ]
        [wave] = elimination.chart([heat], 2)
        [drawn] = wave.heats
        skipped = drawn.lanes[2]
        assert skipped.outcome == "SKIPPED"
        assert skipped.losses_after == 0

    def test_a_dnf_is_a_loss_on_the_chart_too(self):
        heat = [_lane(1, 1, time=3.0, place=1), _lane(2, 2, time=0.0)]
        [wave] = elimination.chart([heat], 2)
        [drawn] = wave.heats
        assert drawn.lanes[1].outcome == "LOST"

    def test_a_lone_finisher_names_no_winner(self):
        # `losses_by_racer` charges nobody in a heat with one finisher, so
        # the chart marks nothing rather than a win nobody was charged for.
        heat = [_lane(1, 1, time=3.0, place=1), _lane(2, 2)]
        [wave] = elimination.chart([heat], 2)
        [drawn] = wave.heats
        assert drawn.finished
        assert [lane.outcome for lane in drawn.lanes] == [None, None]

    def test_every_loss_on_the_chart_is_a_loss_in_the_count(self):
        # The chart is drawn from the same rule that grows the next wave, so
        # summing its marks reproduces `losses_by_racer` exactly.
        rng = random.Random(710)
        racers = list(range(1, 9))
        heats = []
        losses = dict.fromkeys(racers, 0)
        while not elimination.is_decided(losses, 2):
            for group in elimination.next_wave(losses, 2, 4, rng=rng):
                order = list(group)
                rng.shuffle(order)
                heats.append(
                    [
                        _lane(
                            i + 1,
                            r,
                            time=3.0 + order.index(r) * 0.1,
                            place=order.index(r) + 1,
                        )
                        for i, r in enumerate(group)
                    ]
                )
            losses = elimination.losses_by_racer(heats)
        counted: dict[int, int] = {}
        for wave in elimination.chart(heats, 2):
            for heat in wave.heats:
                for lane in heat.lanes:
                    if lane.outcome == "LOST":
                        counted[lane.racer_id] = counted.get(lane.racer_id, 0) + 1
                    counted.setdefault(lane.racer_id, 0)
        assert counted == losses
        # And the last wave drawn is the one that decided it.
        last = elimination.chart(heats, 2)[-1]
        assert any(lane.out for heat in last.heats for lane in heat.lanes)


CHART_QUERY = """
query Chart($raceId: Int!) {
    race(raceId: $raceId) {
        rounds {
            id
            schedulingStrategy
            eliminationChart {
                maxLosses
                decided
                waves {
                    number
                    heats {
                        heatId
                        heatNumber
                        finished
                        lanes { lane racerId outcome lossesAfter out }
                    }
                }
                standings { racerId losses alive }
            }
        }
    }
}
"""


class TestTheChartResolver:
    """`Round.eliminationChart` — the schedule screen's chart (#710)."""

    def _chart(self, client, race_id):
        body = client.post(
            "/graphql", json={"query": CHART_QUERY, "variables": {"raceId": race_id}}
        ).json()
        assert "errors" not in body, body
        (round_data,) = body["data"]["race"]["rounds"]
        return round_data

    def test_a_ppc_round_has_no_chart(self, db, client):
        race = _race(db, "No Chart Derby")
        _racers(db, race.id, 4)
        round_obj = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, round_obj.id)
        round_data = self._chart(client, race.id)
        assert round_data["schedulingStrategy"] == "PPC"
        assert round_data["eliminationChart"] is None

    def test_the_first_wave_is_drawn_pending(self, db, client):
        race, ids, _ = _elimination_round(
            db, "Pending Chart Derby", racer_count=6, max_losses=2
        )
        chart = self._chart(client, race.id)["eliminationChart"]
        assert chart["maxLosses"] == 2
        assert not chart["decided"]
        (wave,) = chart["waves"]
        assert wave["number"] == 1
        assert all(not heat["finished"] for heat in wave["heats"])
        assert all(
            lane["outcome"] is None for heat in wave["heats"] for lane in heat["lanes"]
        )
        assert {entry["racerId"] for entry in chart["standings"]} == set(ids)
        assert all(entry["alive"] for entry in chart["standings"])

    def test_the_chart_follows_the_race_to_its_end(self, db, client):
        race, ids, round_obj = _elimination_round(
            db, "Whole Chart Derby", racer_count=6, max_losses=2
        )
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        chart = self._chart(client, race.id)["eliminationChart"]
        assert not chart["decided"]
        # Wave one raced, wave two appended by the cascade and pending.
        assert [wave["number"] for wave in chart["waves"]] == [1, 2]
        raced, pending = chart["waves"]
        assert all(heat["finished"] for heat in raced["heats"])
        assert all(not heat["finished"] for heat in pending["heats"])
        # Every finished heat names exactly one winner, and the heat ids are
        # the round's own rows.
        heat_ids = {
            h.id
            for h in db.query(models.Heat).filter(models.Heat.round_id == round_obj.id)
        }
        for heat in raced["heats"]:
            assert heat["heatId"] in heat_ids
            outcomes = [lane["outcome"] for lane in heat["lanes"] if lane["racerId"]]
            assert outcomes.count("WON") == 1
            assert all(o in ("WON", "LOST") for o in outcomes)

        for _ in range(20):
            pending_heats = _pending_heats(db, round_obj.id)
            if not pending_heats:
                break
            for heat in pending_heats:
                _run_heat(db, heat, ids)

        chart = self._chart(client, race.id)["eliminationChart"]
        assert chart["decided"]
        alive = [entry for entry in chart["standings"] if entry["alive"]]
        assert [entry["racerId"] for entry in alive] == [ids[0]]
        # The favourite never lost, so is never marked out anywhere.
        assert not any(
            lane["out"]
            for wave in chart["waves"]
            for heat in wave["heats"]
            for lane in heat["lanes"]
            if lane["racerId"] == ids[0]
        )
        # Everyone else reached the limit somewhere on the chart.
        out_ids = {
            lane["racerId"]
            for wave in chart["waves"]
            for heat in wave["heats"]
            for lane in heat["lanes"]
            if lane["out"]
        }
        assert out_ids == set(ids[1:])

    def test_a_withdrawn_car_is_not_shown_as_still_racing(self, db, client):
        race, ids, round_obj = _elimination_round(
            db, "Withdrawn Chart Derby", racer_count=4, max_losses=1
        )
        withdrawn = db.query(models.Racer).filter(models.Racer.id == ids[-1]).one()
        withdrawn.car_passed_inspection = False
        db.commit()
        chart = self._chart(client, race.id)["eliminationChart"]
        assert ids[-1] not in {entry["racerId"] for entry in chart["standings"]}
        # Its lane on the pending wave is still drawn: the row exists.
        assert ids[-1] in {
            lane["racerId"]
            for wave in chart["waves"]
            for heat in wave["heats"]
            for lane in heat["lanes"]
        }


class TestEliminationUsableLanesAndVacating:
    def test_elimination_round_refused_on_track_with_fewer_than_two_usable_lanes(
        self, db
    ):
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack OneLane")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(name="OneLaneTrack", lane_count=1, timer_type="FAKE"),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id, name="Race OneLane", track_id=track.id
            ),
        )
        _racers(db, race.id, 4)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
            name="Elimination Round",
        )
        import pytest

        with pytest.raises(
            ValueError,
            match=(
                "An elimination or balanced round requires at least two usable lanes."
            ),
        ):
            crud.generate_heats_for_round(db, round_obj.id)

    def test_lane_outage_emptying_pending_heat_does_not_stall_round(self, db):
        # 5 racers on a 4-lane track -> wave 1 has 2 heats.
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack Outage")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(name="Track Outage", lane_count=4, timer_type="FAKE"),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id,
                name="Race Outage",
                track_id=track.id,
                scoring_strategy=models.ScoringStrategy.TIMED,
            ),
        )
        ids = _racers(db, race.id, 5)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
            name="Elimination Round",
            elimination_losses=2,
        )
        crud.generate_heats_for_round(db, round_obj.id)

        heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        assert len(heats) == 2

        # Run heat 1
        _run_heat(db, heats[0], ids)

        # For heat 2, identify which lanes have racers
        h2_lanes = crud.heat_lanes_of(db, heats[1])
        used_lanes = [lane.lane for lane in h2_lanes if lane.racer_id is not None]

        # Apply lane outages to all lanes used by heat 2
        crud.set_lane_outages(db, track.id, used_lanes)
        crud.apply_outages_to_scheduled_heats(db, track.id)

        # Round must not stall: either apply_outages extended it or
        # extend_elimination_round does.
        all_heats = (
            db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        )
        new_heats = crud.extend_elimination_round(db, round_obj.id)
        assert len(all_heats) > 2 or len(new_heats) > 0, (
            "Round stalled: extend_elimination_round failed to grow next wave"
        )

    def test_withdrawal_emptying_pending_heat_does_not_stall_round(self, db):
        # 4 racers on a 3-lane track.
        # Wave 1 has 2 heats.
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack Withdraw")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(name="Track Withdraw", lane_count=3, timer_type="FAKE"),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id,
                name="Race Withdraw",
                track_id=track.id,
                scoring_strategy=models.ScoringStrategy.TIMED,
            ),
        )
        ids = _racers(db, race.id, 4)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
            name="Elimination Round",
            elimination_losses=2,
        )
        crud.generate_heats_for_round(db, round_obj.id)

        heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        assert len(heats) == 2

        # Run heat 1
        _run_heat(db, heats[0], ids)

        # Withdraw all racers in heat 2
        h2_lanes = crud.heat_lanes_of(db, heats[1])
        h2_racer_ids = {lane.racer_id for lane in h2_lanes if lane.racer_id is not None}
        for r_id in h2_racer_ids:
            racer = db.query(models.Racer).filter(models.Racer.id == r_id).one()
            racer.car_passed_inspection = False
        db.commit()

        crud.withdraw_absent_racers(db, race.id)

        all_heats = (
            db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        )
        new_heats = crud.extend_elimination_round(db, round_obj.id)
        assert len(all_heats) > 2 or len(new_heats) > 0, (
            "Round stalled: extend_elimination_round failed to grow next wave"
        )
