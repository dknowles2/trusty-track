"""A racer who arrives after the racing has started (#172).

The rule in one line — a round nobody has raced is regenerated with them in it,
a round part-way through keeps every result and gets heats appended, a round
already finished is left alone.

The same three cases as a lane going out of service (#171), because it is the
same problem from the other side: a round already under way has to change, and
the heats people ran must survive it.
"""

from backend.db import crud, models, schemas
from backend.tests.helpers import record_heat_result


def build(db, *, racers=5, strategy=models.ScoringStrategy.TIMED, lane_count=4):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack 42"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Late Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Late Race",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy=strategy,
        ),
    )
    for i in range(racers):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"Racer{i}",
                last_name="Test",
                car_number=800 + i,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return track.id, race.id


def arrive(db, race_id, *, name="Latecomer", checked_in=True, den_id=None):
    """A child turning up after the schedule was built."""
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=name,
            last_name="Late",
            car_number=900,
            race_id=race_id,
            den_id=den_id,
            car_passed_inspection=checked_in,
        ),
    )


def start_round(db, race_id, number=1, den_id=None):
    round_obj = crud.create_round(
        db, race_id=race_id, round_number=number, den_id=den_id
    )
    crud.generate_heats_for_round(db, round_obj.id)
    return round_obj


def run_heats(client, db, race_id, round_id, count=None):
    heats = crud.get_heats(db, race_id, round_id=round_id)
    for heat in heats[: count if count is not None else len(heats)]:
        record_heat_result(
            client,
            heat.id,
            [
                {"lane": lane.lane, "racer_id": lane.racer_id, "time": 3.0 + lane.lane}
                for lane in crud.heat_lanes_of(db, heat)
                if lane.racer_id is not None
            ],
        )


def racers_in(db, race_id, round_id):
    scheduled = set()
    for heat in crud.get_heats(db, race_id, round_id=round_id):
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id is not None:
                scheduled.add(lane.racer_id)
    return scheduled


class TestARoundNobodyHasRaced:
    def test_is_regenerated_with_the_newcomer_in_it(self, db):
        # The outcome to prefer whenever it is available: everybody ends up
        # with an equal schedule and nothing is at risk.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        late = arrive(db, race_id)

        crud.admit_late_racers(db, race_id)

        assert late.id in racers_in(db, race_id, round_obj.id)

    def test_is_not_marked_disrupted(self, db):
        # Nothing was lost, so `POINTS` standings must still count it.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        arrive(db, race_id)

        crud.admit_late_racers(db, race_id)

        db.refresh(round_obj)
        assert round_obj.disrupted is False

    def test_everybody_still_runs_the_same_number_of_heats(self, db):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        arrive(db, race_id)

        crud.admit_late_racers(db, race_id)

        counts: dict[int, int] = {}
        for heat in crud.get_heats(db, race_id, round_id=round_obj.id):
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id is not None:
                    counts[lane.racer_id] = counts.get(lane.racer_id, 0) + 1
        assert len(set(counts.values())) == 1


class TestARoundPartWayThrough:
    def test_keeps_every_recorded_result(self, db, client):
        # The whole point of the guard `may_rebuild` enforces: times people ran
        # are not discarded to make room for somebody who was not there.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        before = {
            heat.id: [
                (lane.lane, lane.racer_id, lane.time)
                for lane in crud.heat_lanes_of(db, heat)
            ]
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)[:2]
        }

        arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        for heat_id, lanes_before in before.items():
            heat = db.query(models.Heat).filter(models.Heat.id == heat_id).one()
            after = [
                (lane.lane, lane.racer_id, lane.time)
                for lane in crud.heat_lanes_of(db, heat)
            ]
            assert after == lanes_before

    def test_appends_heats_for_the_newcomer(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        before = len(crud.get_heats(db, race_id, round_id=round_obj.id))
        run_heats(client, db, race_id, round_obj.id, count=2)

        late = arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        heats = crud.get_heats(db, race_id, round_id=round_obj.id)
        assert len(heats) > before
        assert late.id in racers_in(db, race_id, round_obj.id)

    def test_the_newcomer_runs_every_lane_once(self, db, client):
        # Lane bias is what PPC exists to even out, so a latecomer admitted
        # into one lane four times has not been given a fair round.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        late = arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        lanes_run = sorted(
            lane.lane
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
            for lane in crud.heat_lanes_of(db, heat)
            if lane.racer_id == late.id
        )
        assert lanes_run == [1, 2, 3, 4]

    def test_the_appended_heats_come_last(self, db, client):
        # The operator is part-way down a running order; new heats belong at
        # the end of it, not spliced into the middle of the afternoon.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        highest = max(
            heat.heat_number
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
        )

        late = arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        appended = [
            heat
            for heat in crud.get_heats(db, race_id, round_id=round_obj.id)
            if any(lane.racer_id == late.id for lane in crud.heat_lanes_of(db, heat))
        ]
        assert appended
        assert all(heat.heat_number > highest for heat in appended)

    def test_marks_the_round_disrupted(self, db, client):
        # Whoever fills the other lanes of the appended heats runs more often
        # than their peers, which is exactly what `disrupted` records.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        arrive(db, race_id)
        disrupted = crud.admit_late_racers(db, race_id)

        db.refresh(round_obj)
        assert round_obj.disrupted is True
        assert disrupted == [round_obj.id]

    def test_a_disrupted_round_drops_out_of_points_standings(self, db, client):
        from backend.services import scoring

        _, race_id = build(db, strategy=models.ScoringStrategy.POINTS)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        db.refresh(round_obj)
        assert round_obj.disrupted is True
        assert scoring.get_leaderboard(db, race_id) == []

    def test_a_disrupted_round_still_counts_under_timed_scoring(self, db, client):
        # An average is scale-free, so an uneven heat count is not a reason to
        # throw the round away — the same asymmetry #171 established.
        from backend.services import scoring

        _, race_id = build(db, strategy=models.ScoringStrategy.TIMED)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        assert scoring.get_leaderboard(db, race_id)


class TestARoundAlreadyFinished:
    def test_is_left_alone(self, db, client):
        # Appending would be asking people to come back to a round they have
        # finished. The newcomer joins from the next one.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id)
        before = len(crud.get_heats(db, race_id, round_id=round_obj.id))

        late = arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        assert len(crud.get_heats(db, race_id, round_id=round_obj.id)) == before
        assert late.id not in racers_in(db, race_id, round_obj.id)

    def test_is_not_marked_disrupted(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id)

        arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        db.refresh(round_obj)
        assert round_obj.disrupted is False


class TestWhoIsAdmitted:
    def test_a_racer_who_has_not_checked_in_is_not(self, db, client):
        # `car_passed_inspection` is what the generator fields from, so a
        # racer on the roster and not yet inspected is not eligible for a heat.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        late = arrive(db, race_id, checked_in=False)
        crud.admit_late_racers(db, race_id)

        assert late.id not in racers_in(db, race_id, round_obj.id)

    def test_a_championship_round_is_never_touched(self, db, client):
        # Its field comes from the standings. A latecomer becomes eligible by
        # racing the preliminaries, not by being inserted into the final.
        #
        # The final has to be *advanced* for this to test anything. While it
        # still holds placeholders, dropping the championship filter regenerates
        # it into an identical round of placeholders, so the check passes
        # whether the filter is there or not.
        _, race_id = build(db)
        prelim = start_round(db, race_id)
        run_heats(client, db, race_id, prelim.id)
        final = crud.create_round(
            db,
            race_id=race_id,
            round_number=2,
            advancement_source="PACK",
            advancement_num_racers=4,
        )
        crud.generate_heats_for_round(db, final.id, num_placeholders=4)
        crud.populate_round_field(
            db, final.id, sorted(racers_in(db, race_id, prelim.id))[:4]
        )
        field_before = racers_in(db, race_id, final.id)
        assert field_before, "the final must hold real racers for this to test anything"
        before = len(crud.get_heats(db, race_id, round_id=final.id))

        late = arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        assert len(crud.get_heats(db, race_id, round_id=final.id)) == before
        assert racers_in(db, race_id, final.id) == field_before
        assert late.id not in racers_in(db, race_id, final.id)

    def test_a_den_round_only_admits_its_own_den(self, db, client):
        _, race_id = build(db)
        wolves = crud.create_den(
            db, schemas.DenCreate(name="Wolves", color="#8B4513"), race_id
        )
        bears = crud.create_den(
            db, schemas.DenCreate(name="Bears", color="#1E5631"), race_id
        )
        for racer in db.query(models.Racer).filter(models.Racer.race_id == race_id):
            racer.den_id = wolves.id
        db.commit()

        round_obj = start_round(db, race_id, den_id=wolves.id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        outsider = arrive(db, race_id, den_id=bears.id)
        crud.admit_late_racers(db, race_id)

        assert outsider.id not in racers_in(db, race_id, round_obj.id)

    def test_admission_is_idempotent(self, db, client):
        # It runs on every check-in, and a desk queue is sixty of them.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        arrive(db, race_id)

        crud.admit_late_racers(db, race_id)
        after_first = len(crud.get_heats(db, race_id, round_id=round_obj.id))
        crud.admit_late_racers(db, race_id)

        assert len(crud.get_heats(db, race_id, round_id=round_obj.id)) == after_first

    def test_a_round_with_no_heats_is_left_for_the_generator(self, db):
        # Created but never generated: whenever it is, it fields whoever has
        # checked in by then, so there is nothing to admit anybody to.
        _, race_id = build(db)
        round_obj = crud.create_round(db, race_id=race_id, round_number=1)

        arrive(db, race_id)
        crud.admit_late_racers(db, race_id)

        assert crud.get_heats(db, race_id, round_id=round_obj.id) == []


class TestTheMutationsThatTriggerIt:
    """Admission has to reach the operator through a resolver, not a helper.

    Every test above calls ``crud.admit_late_racers`` directly, which says
    nothing about whether checking somebody in actually calls it — and that
    wiring is the whole feature. Four mutations put a racer into a round's
    field, and #48 is the standing reminder about a rule landing on only some
    of the paths that need it.
    """

    def _gql(self, client, query, variables):
        response = client.post(
            "/graphql", json={"query": query, "variables": variables}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert "errors" not in body, body["errors"]
        return body["data"]

    def test_check_in_racer_admits_them(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        late = arrive(db, race_id, checked_in=False)

        self._gql(
            client,
            """
            mutation CheckIn($id: Int!) {
                checkInRacer(id: $id, passedInspection: true, weight: 141.0) { id }
            }
            """,
            {"id": late.id},
        )

        db.expire_all()
        assert late.id in racers_in(db, race_id, round_obj.id)

    def test_creating_an_already_inspected_racer_admits_them(self, db, client):
        # The check-in desk adding somebody who was never on the roster, which
        # is the commonest way a latecomer actually arrives.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        created = self._gql(
            client,
            """
            mutation Add($racer: RacerInput!) {
                createRacer(racer: $racer) { id }
            }
            """,
            {
                "racer": {
                    "raceId": race_id,
                    "firstName": "Walk",
                    "lastName": "Up",
                    "carNumber": 901,
                    "carPassedInspection": True,
                }
            },
        )

        db.expire_all()
        assert created["createRacer"]["id"] in racers_in(db, race_id, round_obj.id)

    def test_bulk_check_in_admits_them(self, db, client):
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        one = arrive(db, race_id, name="One", checked_in=False)
        two = arrive(db, race_id, name="Two", checked_in=False)

        self._gql(
            client,
            """
            mutation BulkIn($ids: [Int!]!) {
                bulkCheckIn(racerIds: $ids, passedInspection: true)
            }
            """,
            {"ids": [one.id, two.id]},
        )

        db.expire_all()
        scheduled = racers_in(db, race_id, round_obj.id)
        assert one.id in scheduled
        assert two.id in scheduled

    def test_checking_somebody_out_admits_nobody(self, db, client):
        # `passedInspection: false` is a withdrawal. It must not append heats,
        # and in particular must not mark the round disrupted for nothing.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        before = len(crud.get_heats(db, race_id, round_id=round_obj.id))
        established = sorted(racers_in(db, race_id, round_obj.id))[0]

        self._gql(
            client,
            """
            mutation CheckOut($id: Int!) {
                checkInRacer(id: $id, passedInspection: false, weight: null) { id }
            }
            """,
            {"id": established},
        )

        db.expire_all()
        assert len(crud.get_heats(db, race_id, round_id=round_obj.id)) == before
        db.refresh(round_obj)
        assert round_obj.disrupted is False

    def test_import_racers_admits_a_pre_checked_in_row(self, db, client):
        # The canonical CSV carries passed_inspection, and a spreadsheet
        # import of already-inspected racers after a round is generated is
        # exactly an arrival (#343) — the same as check-in, just batched.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)

        imported = self._gql(
            client,
            """
            mutation Import($raceId: Int!, $csvData: String!) {
                importRacers(raceId: $raceId, csvData: $csvData)
            }
            """,
            {
                "raceId": race_id,
                "csvData": (
                    "first_name,last_name,car_number,car_passed_inspection\n"
                    "Spreadsheet,Import,950,yes\n"
                ),
            },
        )

        assert imported["importRacers"] == 1
        db.expire_all()
        scheduled = racers_in(db, race_id, round_obj.id)
        assert len(scheduled) > 0
        imported_racer = (
            db.query(models.Racer)
            .filter(models.Racer.race_id == race_id, models.Racer.car_number == 950)
            .one()
        )
        assert imported_racer.id in scheduled

    def test_import_racers_leaves_uninspected_rows_unscheduled(self, db, client):
        # A row with no inspection column stays unchecked, the same as the
        # single-racer creation path — import must not schedule everyone.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        before = len(crud.get_heats(db, race_id, round_id=round_obj.id))

        self._gql(
            client,
            """
            mutation Import($raceId: Int!, $csvData: String!) {
                importRacers(raceId: $raceId, csvData: $csvData)
            }
            """,
            {
                "raceId": race_id,
                "csvData": "first_name,last_name,car_number\nNot,Inspected,951\n",
            },
        )

        db.expire_all()
        assert len(crud.get_heats(db, race_id, round_id=round_obj.id)) == before

    def test_update_racer_admits_them(self, db, client):
        # Editing a racer and ticking the inspection box reaches the field the
        # same way check-in does, so it has to admit them the same way.
        _, race_id = build(db)
        round_obj = start_round(db, race_id)
        run_heats(client, db, race_id, round_obj.id, count=2)
        late = arrive(db, race_id, checked_in=False)

        self._gql(
            client,
            """
            mutation Edit($id: Int!, $racer: RacerInput!) {
                updateRacer(id: $id, racer: $racer) { id }
            }
            """,
            {
                "id": late.id,
                "racer": {
                    "raceId": race_id,
                    "firstName": "Latecomer",
                    "lastName": "Late",
                    "carPassedInspection": True,
                },
            },
        )

        db.expire_all()
        assert late.id in racers_in(db, race_id, round_obj.id)
