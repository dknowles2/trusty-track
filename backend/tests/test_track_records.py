"""Track records: the fastest cars a track has ever seen, across races.

The service is `services/records.py`; `raceStats` carries the result as
`trackRecords`. A record is computed on every read — the same rule as the
standings (#17) — so a corrected time moves it, and deleting a race deletes
the records it set.
"""

from backend.db import crud, models, schemas
from backend.domain import lanes as lanes_module
from backend.domain.audit import ResultSource
from backend.services import records


def _group_and_track(db, name, lane_count=4):
    group = crud.create_group(db, schemas.GroupCreate(name=f"Pack for {name}"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"Track for {name}", lane_count=lane_count, timer_type="FAKE"
        ),
    )
    return group, track


def _race_on(db, group, track, name) -> models.Race:
    return crud.create_race(
        db,
        schemas.RaceCreate(
            group_id=group.id,
            name=name,
            track_id=track.id,
            scoring_strategy=models.ScoringStrategy.TIMED,
        ),
    )


def _racers(db, race_id, names) -> dict[str, int]:
    """Create checked-in racers; returns first name -> id."""
    out = {}
    for n, first in enumerate(names):
        out[first] = crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=first,
                last_name="Speed",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        ).id
    return out


def _first_heat(db, race_id) -> models.Heat:
    round_obj = crud.create_round(
        db,
        race_id=race_id,
        round_number=1,
        scheduling_strategy=models.SchedulingStrategy.PPC,
        name="Qualifying",
    )
    crud.generate_heats_for_round(db, round_obj.id)
    return (
        db.query(models.Heat)
        .filter(models.Heat.round_id == round_obj.id)
        .order_by(models.Heat.heat_number)
        .first()
    )


def _record(db, heat, times_by_racer):
    """Record the heat with the given time per racer id (None = leave pending)."""
    stored = crud.heat_lanes_of(db, heat)
    recorded = [
        lanes_module.Lane(
            lane=lane.lane,
            racer_id=lane.racer_id,
            time=times_by_racer.get(lane.racer_id),
        )
        for lane in stored
    ]
    crud.record_heat_result(db, heat.id, recorded, source=ResultSource.OPERATOR)


def _raced_race(db, group, track, name, times_by_first):
    """A race on the track whose first heat ran with the given times."""
    race = _race_on(db, group, track, name)
    ids = _racers(db, race.id, list(times_by_first))
    heat = _first_heat(db, race.id)
    _record(db, heat, {ids[first]: t for first, t in times_by_first.items()})
    return race, ids, heat


class TestTheRecordList:
    def test_the_record_spans_every_race_on_the_track(self, db):
        group, track = _group_and_track(db, "Spanning")
        _raced_race(
            db, group, track, "Derby 2025", {"Ada": 3.1, "Bea": 3.4, "Cal": 3.6}
        )
        _raced_race(
            db, group, track, "Derby 2026", {"Dee": 2.9, "Eli": 3.3, "Fay": 3.5}
        )

        entries = records.track_records(db, track.id)
        assert [(e.racer_name, e.time_seconds) for e in entries[:2]] == [
            ("Dee Speed", 2.9),
            ("Ada Speed", 3.1),
        ]
        assert entries[0].race_name == "Derby 2026"
        assert entries[1].race_name == "Derby 2025"

    def test_one_entry_per_racer_at_their_best(self, db):
        # A fast car wins several heats; the list is fastest cars, not
        # fastest runs, so it holds the car once, at its single best time.
        group, track = _group_and_track(db, "Dedupe")
        race = _race_on(db, group, track, "Dedupe Derby")
        ids = _racers(db, race.id, ["Ada", "Bea", "Cal"])
        round_obj = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.PPC,
            name="Qualifying",
        )
        crud.generate_heats_for_round(db, round_obj.id)
        heats = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id)
            .order_by(models.Heat.heat_number)
            .all()
        )
        _record(db, heats[0], {ids["Ada"]: 3.2, ids["Bea"]: 3.5, ids["Cal"]: 3.6})
        _record(db, heats[1], {ids["Ada"]: 3.0, ids["Bea"]: 3.4, ids["Cal"]: 3.7})

        entries = records.track_records(db, track.id)
        names = [e.racer_name for e in entries]
        assert names == ["Ada Speed", "Bea Speed", "Cal Speed"]
        assert entries[0].time_seconds == 3.0

    def test_a_free_race_heat_cannot_hold_the_record(self, db):
        # Dad's car doing 2.5 in an exhibition run must not take the record.
        group, track = _group_and_track(db, "Free")
        race, ids, _ = _raced_race(
            db, group, track, "Free Derby", {"Ada": 3.2, "Bea": 3.5}
        )
        free = crud.create_free_race_heat(
            db, race.id, [lanes_module.Lane(lane=1, racer_id=ids["Ada"])]
        )
        crud.update_free_race_heat_result(
            db,
            free.id,
            [lanes_module.Lane(lane=1, racer_id=ids["Ada"], time=2.5, place=1)],
            source=ResultSource.OPERATOR,
        )

        entries = records.track_records(db, track.id)
        assert entries[0].time_seconds == 3.2

    def test_a_dnf_is_not_a_record(self, db):
        # A recorded 0.0 is a start with no finish, and it would otherwise be
        # the fastest time ever seen.
        group, track = _group_and_track(db, "DNF")
        _raced_race(db, group, track, "DNF Derby", {"Ada": 0.0, "Bea": 3.5})

        entries = records.track_records(db, track.id)
        assert [(e.racer_name, e.time_seconds) for e in entries] == [("Bea Speed", 3.5)]

    def test_another_tracks_races_do_not_count(self, db):
        group, track = _group_and_track(db, "Home")
        _raced_race(db, group, track, "Home Derby", {"Ada": 3.2, "Bea": 3.5})
        other_group, other_track = _group_and_track(db, "Away")
        _raced_race(
            db, other_group, other_track, "Away Derby", {"Zed": 2.0, "Yan": 2.1}
        )

        entries = records.track_records(db, track.id)
        assert [e.racer_name for e in entries] == ["Ada Speed", "Bea Speed"]

    def test_the_list_is_capped(self, db):
        group, track = _group_and_track(db, "Capped")
        _raced_race(
            db,
            group,
            track,
            "Capped Derby",
            {"A": 3.1, "B": 3.2, "C": 3.3, "D": 3.4},
        )
        assert len(records.track_records(db, track.id, limit=2)) == 2

    def test_a_corrected_time_moves_the_record(self, db):
        # The record is computed, never stored — the same rule as the
        # standings (#17), and the reason a fat-fingered 0.3 does not stand
        # as the track record forever.
        group, track = _group_and_track(db, "Corrected")
        race, ids, heat = _raced_race(
            db, group, track, "Corrected Derby", {"Ada": 0.3, "Bea": 3.5}
        )
        assert records.track_records(db, track.id)[0].time_seconds == 0.3

        _record(db, heat, {ids["Ada"]: 3.3, ids["Bea"]: 3.5})
        assert records.track_records(db, track.id)[0].time_seconds == 3.3

    def test_deleting_the_race_deletes_its_records(self, db):
        group, track = _group_and_track(db, "Deleted")
        race, _, _ = _raced_race(
            db, group, track, "Deleted Derby", {"Ada": 2.9, "Bea": 3.5}
        )
        _raced_race(db, group, track, "Kept Derby", {"Cal": 3.2, "Dee": 3.6})

        crud.delete_race(db, race.id)
        entries = records.track_records(db, track.id)
        assert entries[0].racer_name == "Cal Speed"


class TestTheResolver:
    def test_race_stats_carries_the_track_records(self, client, db):
        group, track = _group_and_track(db, "Resolver")
        _raced_race(db, group, track, "Resolver Derby 2025", {"Ada": 3.05, "Bea": 3.4})
        race, _, _ = _raced_race(
            db, group, track, "Resolver Derby 2026", {"Cal": 3.2, "Dee": 3.6}
        )

        resp = client.post(
            "/graphql",
            json={
                "query": f"""
                query {{
                    raceStats(raceId: {race.id}) {{
                        trackRecords {{
                            timeSeconds racerName carNumber
                            raceId raceName raceDate
                        }}
                    }}
                }}
                """
            },
        )
        assert resp.status_code == 200
        entries = resp.json()["data"]["raceStats"]["trackRecords"]
        assert entries[0]["racerName"] == "Ada Speed"
        assert entries[0]["timeSeconds"] == 3.05
        # The holder's race, so the screen can say whether the record was
        # set at this event or stands from an earlier one.
        assert entries[0]["raceName"] == "Resolver Derby 2025"
        assert entries[0]["raceId"] != race.id
