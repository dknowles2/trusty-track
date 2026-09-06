"""Balanced racing: each phase matches cars with similar records.

The pure rules live in `domain/balanced.py`; the database half is the
BALANCED branch of `generate_heats_for_round` plus `extend_balanced_round`
on the recorded-result cascade. GPRM calls the method "Dynamic".
"""

import random

from backend.db import crud, models, schemas
from backend.domain import balanced
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource


def _lane(lane, racer_id, time=None, place=None, skipped=False):
    return lanes_module.Lane(
        lane=lane, racer_id=racer_id, time=time, place=place, skipped=skipped
    )


class TestRecords:
    def test_wins_and_points_come_from_places(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=3.2, place=2),
            _lane(3, 3, time=3.4, place=3),
        ]
        recs = balanced.records([heat])
        assert (recs[1].wins, recs[1].points, recs[1].heats) == (1, 1, 1)
        assert (recs[2].wins, recs[2].points) == (0, 2)
        assert (recs[3].wins, recs[3].points) == (0, 3)

    def test_a_dnf_scores_last_and_a_skip_scores_nothing(self):
        heat = [
            _lane(1, 1, time=3.0, place=1),
            _lane(2, 2, time=0.0),
            _lane(3, 3, skipped=True),
        ]
        recs = balanced.records([heat])
        assert recs[2].points == 3
        assert recs[3].heats == 0


class TestTheOrder:
    def test_most_wins_first_then_fewest_points(self):
        entries = [
            balanced.Record(racer_id=1, wins=0, points=4, heats=2),
            balanced.Record(racer_id=2, wins=2, points=2, heats=2),
            balanced.Record(racer_id=3, wins=1, points=3, heats=2),
        ]
        assert balanced.performance_order(entries) == [2, 3, 1]

    def test_an_unknown_record_goes_last_not_first(self):
        # A latecomer has zero points, which a raw GPRM-style total would
        # rank above everyone. Zero heats is no record, not a perfect one.
        entries = [
            balanced.Record(racer_id=1, wins=0, points=6, heats=2),
            balanced.Record(racer_id=9),
        ]
        assert balanced.performance_order(entries) == [1, 9]


class TestThePhase:
    def test_neighbours_race_neighbours(self):
        phase = balanced.next_phase(
            [1, 2, 3, 4, 5, 6, 7, 8], {}, [1, 2, 3, 4], rng=random.Random(7)
        )
        assert [sorted(r for _lane, r in heat) for heat in phase] == [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
        ]

    def test_nobody_races_alone(self):
        phase = balanced.next_phase(
            [1, 2, 3, 4, 5], {}, [1, 2, 3, 4], rng=random.Random(7)
        )
        assert all(len(heat) >= 2 for heat in phase)
        assert sum(len(heat) for heat in phase) == 5

    def test_lanes_go_to_whoever_has_used_them_least(self):
        # Racer 1 has run lane 1 twice, racer 2 never — over any tiebreak,
        # lane 1 must go to racer 2.
        uses = {1: {1: 2, 2: 0}, 2: {1: 0, 2: 2}}
        phase = balanced.next_phase([1, 2], uses, [1, 2], rng=random.Random(7))
        assert phase == [[(1, 2), (2, 1)]]

    def test_a_lone_car_races_nobody(self):
        assert balanced.next_phase([1], {}, [1, 2, 3, 4]) == []

    def test_next_phase_usable_lanes_under_two_returns_empty(self):
        assert balanced.next_phase([1, 2], {}, usable_lanes=[1]) == []

    def test_next_phase_two_lanes_odd_racers_no_intermediate_solo_heat(self):
        phase = balanced.next_phase(
            [1, 2, 3, 4, 5], {}, usable_lanes=[1, 2], rng=random.Random(1)
        )
        assert all(len(h) == 2 for h in phase[:-1])
        assert all(len(h) > 0 for h in phase)

    def test_tail_rebalancing_property(self):
        for num_lanes in range(1, 6):
            usable = list(range(1, num_lanes + 1))
            for n in range(2, 16):
                racers = list(range(1, n + 1))
                phase = balanced.next_phase(racers, {}, usable_lanes=usable)
                if num_lanes < 2:
                    assert phase == []
                elif num_lanes >= 3:
                    assert all(len(h) >= 2 for h in phase)
                else:
                    assert all(len(h) == 2 for h in phase[:-1])
                    assert all(len(h) > 0 for h in phase)


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
                last_name="Balanced",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
        for n in range(count)
    ]


def _balanced_round(db, name, racer_count=8, phases=3):
    race = _race(db, name)
    ids = _racers(db, race.id, racer_count)
    round_obj = crud.create_round(
        db,
        race_id=race.id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.BALANCED,
        name="Balanced Round",
        balanced_phases=phases,
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


def _play(db, round_id, ids, max_rounds=20):
    for _ in range(max_rounds):
        pending = _pending_heats(db, round_id)
        if not pending:
            return
        for heat in pending:
            _run_heat(db, heat, ids)
    raise AssertionError("the balanced round never finished")


class TestTheRound:
    def test_everyone_races_once_per_phase_until_the_target(self, db):
        race, ids, round_obj = _balanced_round(db, "Balanced Derby", phases=3)
        _play(db, round_obj.id, ids)

        heats = db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        apps = balanced.appearances(crud.lanes_for_heats(db, heats))
        assert set(apps) == set(ids)
        assert all(count == 3 for count in apps.values())
        assert crud.is_round_complete(db, round_obj.id)

    def test_later_phases_match_cars_with_similar_records(self, db):
        race, ids, round_obj = _balanced_round(db, "Matched Derby", phases=2)
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        # The point of the method: winners race winners next, so the other
        # heat is winnable by somebody new. Phase one had two heats and two
        # winners; both must land in the same phase-two heat.
        finished = [
            h
            for h in db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .all()
            if lanes_module.is_finished(crud.heat_lanes_of(db, h))
        ]
        winners = {
            min(
                (
                    lane.racer_id
                    for lane in crud.heat_lanes_of(db, heat)
                    if lane.racer_id
                ),
                key=ids.index,
            )
            for heat in finished
        }
        assert len(winners) == 2

        pending = _pending_heats(db, round_obj.id)
        fields = [
            {lane.racer_id for lane in crud.heat_lanes_of(db, heat) if lane.racer_id}
            for heat in pending
        ]
        assert len(pending) == 2
        assert sorted(len(field) for field in fields) == [4, 4]
        assert any(winners <= field for field in fields)

    def test_between_phases_the_round_is_not_complete(self, db):
        race, ids, round_obj = _balanced_round(db, "Waving Balanced Derby", phases=2)
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)

        assert not crud.is_round_complete(db, round_obj.id)
        assert _pending_heats(db, round_obj.id)

    def test_a_deleted_pending_phase_does_not_complete_the_round(self, db):
        """The reachable "all finished, nothing pending, target unmet" state
        is the operator deleting the pending phase — completeness must still
        say no, or a championship downstream fills off a half-run round."""
        race, ids, round_obj = _balanced_round(db, "Deleted Phase Derby", phases=2)
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids)
        pending = _pending_heats(db, round_obj.id)
        assert pending
        for heat in pending:
            crud.delete_heat(db, heat.id)

        assert not crud.is_round_complete(db, round_obj.id)

    def test_balanced_heats_do_feed_the_standings(self, db):
        from backend.services import scoring

        race, ids, round_obj = _balanced_round(db, "Counted Derby", phases=2)
        _play(db, round_obj.id, ids)

        board = scoring.get_leaderboard(db, race.id)
        assert board[0]["racer_id"] == ids[0]
        assert all(entry["heats_completed"] == 2 for entry in board)

    def test_a_latecomer_joins_the_next_phase_and_disrupts_the_round(self, db):
        race, ids, round_obj = _balanced_round(db, "Late Balanced Derby", phases=3)
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
        # Phases are append-only: the phase already on the schedule stands,
        # and the newcomer appears in the one generated after it.
        for heat in _pending_heats(db, round_obj.id):
            _run_heat(db, heat, ids + [late.id])

        pending = _pending_heats(db, round_obj.id)
        scheduled = {
            lane.racer_id
            for h in pending
            for lane in crud.heat_lanes_of(db, h)
            if lane.racer_id
        }
        assert late.id in scheduled

        # They have raced fewer heats than everyone else, which a POINTS sum
        # mistakes for a better score — the same unevenness as #172.
        db.refresh(round_obj)
        assert round_obj.disrupted

    def test_the_resolver_defaults_phases_to_the_lane_count(self, db, client):
        race = _race(db, "Resolver Balanced Derby")
        _racers(db, race.id, 6)

        body = client.post(
            "/graphql",
            json={
                "query": """
                mutation Create($raceId: Int!, $roundData: RoundCreateInput!) {
                    createRound(raceId: $raceId, roundData: $roundData) {
                        id name schedulingStrategy balancedPhases
                    }
                }
                """,
                "variables": {
                    "raceId": race.id,
                    "roundData": {"schedulingStrategy": "BALANCED"},
                },
            },
        ).json()
        assert "errors" not in body, body
        (made,) = body["data"]["createRound"]
        assert made["name"] == "Balanced Round"
        assert made["schedulingStrategy"] == "BALANCED"
        # The track has four lanes; GPRM's advice is one phase per lane.
        assert made["balancedPhases"] == 4

        db.expire_all()
        heats = db.query(models.Heat).filter(models.Heat.round_id == made["id"]).all()
        assert heats, "the first phase should be scheduled at creation"

    def test_a_balanced_championship_round_is_refused(self, db, client):
        race = _race(db, "Refused Balanced Derby")
        _racers(db, race.id, 6)

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
                        "schedulingStrategy": "BALANCED",
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


class TestBalancedUsableLanesAndVacating:
    def test_balanced_round_refused_on_track_with_fewer_than_two_usable_lanes(self, db):
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack OneLane Bal")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(
                name="OneLaneTrack Bal", lane_count=1, timer_type="FAKE"
            ),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id,
                name="Race OneLane Bal",
                track_id=track.id,
                scoring_strategy=models.ScoringStrategy.TIMED,
            ),
        )
        _racers(db, race.id, 4)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.BALANCED,
            name="Balanced Round",
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
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack Bal Outage")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(
                name="Track Bal Outage", lane_count=4, timer_type="FAKE"
            ),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id,
                name="Race Bal Outage",
                track_id=track.id,
                scoring_strategy=models.ScoringStrategy.TIMED,
            ),
        )
        ids = _racers(db, race.id, 5)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.BALANCED,
            name="Balanced Round",
            balanced_phases=2,
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

        # Apply lane outages to all lanes used by heat 2
        h2_lanes = crud.heat_lanes_of(db, heats[1])
        used_lanes = [lane.lane for lane in h2_lanes if lane.racer_id is not None]

        crud.set_lane_outages(db, track.id, used_lanes)
        crud.apply_outages_to_scheduled_heats(db, track.id)

        # Round must not stall: either apply_outages extended it or
        # extend_balanced_round does
        all_heats = (
            db.query(models.Heat).filter(models.Heat.round_id == round_obj.id).all()
        )
        new_heats = crud.extend_balanced_round(db, round_obj.id)
        assert len(all_heats) > 2 or len(new_heats) > 0, (
            "Round stalled: extend_balanced_round failed to grow next phase"
        )

    def test_withdrawal_emptying_pending_heat_does_not_stall_round(self, db):
        group = crud.create_organization(
            db, schemas.OrganizationCreate(name="Pack Bal Withdraw")
        )
        track = crud.create_track(
            db,
            schemas.TrackCreate(
                name="Track Bal Withdraw", lane_count=3, timer_type="FAKE"
            ),
        )
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                organization_id=group.id,
                name="Race Bal Withdraw",
                track_id=track.id,
                scoring_strategy=models.ScoringStrategy.TIMED,
            ),
        )
        ids = _racers(db, race.id, 4)
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.BALANCED,
            name="Balanced Round",
            balanced_phases=2,
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
        new_heats = crud.extend_balanced_round(db, round_obj.id)
        assert len(all_heats) > 2 or len(new_heats) > 0, (
            "Round stalled: extend_balanced_round failed to grow next phase"
        )
