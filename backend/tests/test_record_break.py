"""The audience celebration when a heat breaks the track record.

The rule is `records.broken_record` over a baseline of `track_records`
*excluding the race being run* — the record as it stood before today. The
`timingStats` payload carries the result as `recordBreak`, so the projector
overlay and the timing view announce it without holding any state of their
own.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.services import records
from backend.tests.helpers import as_lanes


class TestTheRule:
    def _baseline(self, seconds=2.9):
        return records.TrackRecordEntry(
            time_seconds=seconds,
            racer_name="Jimmy Legend",
            car_number=42,
            race_id=None,
            race_name="Derby 2019",
            race_date=None,
        )

    def test_a_faster_time_breaks_it(self):
        assert records.broken_record([3.1, 2.85, 3.4], self._baseline()) == 2.85

    def test_no_history_means_nothing_to_break(self):
        # A pack's first event must not "set the record" on heat one and
        # re-break it all morning.
        assert records.broken_record([2.5], None) is None

    def test_equalling_the_record_is_not_breaking_it(self):
        assert records.broken_record([2.9], self._baseline()) is None

    def test_a_slower_heat_breaks_nothing(self):
        assert records.broken_record([3.0, 3.1], self._baseline()) is None

    def test_a_dnf_cannot_break_anything(self):
        # A recorded 0.0 is a start with no finish, not the fastest run in
        # the track's history.
        assert records.broken_record([0.0], self._baseline()) is None
        assert records.broken_record([], self._baseline()) is None


# --- The payload, through the same door the audience display uses ---


@pytest.fixture
def track(db):
    return crud.create_track(
        db, schemas.TrackCreate(name="Record Track", lane_count=2, timer_type="FAKE")
    )


@pytest.fixture
def group(db):
    return crud.create_organization(db, schemas.OrganizationCreate(name="Record Pack"))


def _race(db, group, track, name):
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name=name,
            organization_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


def _racers(db, race, names=("Alice", "Bob")):
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=name,
                last_name="T",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for name in names
    ]


def _heat(db, race, round_obj, racers, heat_number=1):
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=heat_number)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(
        heat,
        as_lanes(
            [
                {"lane": index + 1, "racer_id": racer.id}
                for index, racer in enumerate(racers)
            ]
        ),
    )
    db.commit()
    return heat


def _record(db, heat, winning_seconds):
    heat_lanes = crud.heat_lanes_of(db, heat)
    for index, lane in enumerate(heat_lanes):
        lane.time = winning_seconds + index / 10
        lane.place = index + 1
    if heat.kind is models.HeatKind.FREE:
        crud.update_free_race_heat_result(
            db, heat.id, heat_lanes, source=audit.ResultSource.OPERATOR
        )
    else:
        crud.record_heat_result(
            db, heat.id, heat_lanes, source=audit.ResultSource.OPERATOR
        )


def _historical(db, track_id, seconds, name="Jimmy Legend", label="Derby 2019"):
    return crud.create_historical_track_record(
        db,
        track_id,
        schemas.HistoricalTrackRecordCreate(
            time_seconds=seconds, racer_name=name, race_name=label
        ),
    )


async def _timing_stats(db, race_id):
    from backend.api.schema import Subscription

    class MockInfo:
        context = {"db": db}

    generator = Subscription().timing_stats(MockInfo(), race_id)
    try:
        return await generator.__anext__()
    finally:
        await generator.aclose()


@pytest.mark.anyio
async def test_beating_a_historical_record_is_announced(db, group, track):
    _historical(db, track.id, 3.05)
    race = _race(db, group, track, "Announced Derby")
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    _record(db, _heat(db, race, round_one, racers), 2.98)

    stats = await _timing_stats(db, race.id)
    assert stats.record_break is not None
    assert stats.record_break.new_seconds == 2.98
    assert stats.record_break.new_holder == "Alice T"
    assert stats.record_break.previous_seconds == 3.05
    assert stats.record_break.previous_holder == "Jimmy Legend"
    assert stats.record_break.previous_race_name == "Derby 2019"


@pytest.mark.anyio
async def test_a_first_event_with_no_history_celebrates_nothing(db, group, track):
    race = _race(db, group, track, "First Derby")
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    _record(db, _heat(db, race, round_one, racers), 2.5)

    stats = await _timing_stats(db, race.id)
    assert stats.record_break is None


@pytest.mark.anyio
async def test_todays_own_earlier_heats_are_not_the_baseline(db, group, track):
    # Heat one runs 3.0; heat two runs 2.9. Faster, but there was no record
    # before today, so there is still nothing to break — the exclusion is
    # per race, not per heat.
    race = _race(db, group, track, "Own Baseline Derby")
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    _record(db, _heat(db, race, round_one, racers, heat_number=1), 3.0)
    _record(db, _heat(db, race, round_one, racers, heat_number=2), 2.9)

    stats = await _timing_stats(db, race.id)
    assert stats.record_break is None


@pytest.mark.anyio
async def test_an_earlier_race_on_the_track_is_the_baseline(db, group, track):
    last_year = _race(db, group, track, "Derby Last Year")
    last_racers = _racers(db, last_year, names=("Cora", "Dev"))
    last_round = crud.create_round(db, race_id=last_year.id, round_number=1)
    _record(db, _heat(db, last_year, last_round, last_racers), 3.0)

    race = _race(db, group, track, "Derby This Year")
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    _record(db, _heat(db, race, round_one, racers), 2.95)

    stats = await _timing_stats(db, race.id)
    assert stats.record_break is not None
    assert stats.record_break.previous_holder == "Cora T"
    assert stats.record_break.previous_race_name == "Derby Last Year"


@pytest.mark.anyio
async def test_a_slower_heat_is_not_announced(db, group, track):
    _historical(db, track.id, 2.5)
    race = _race(db, group, track, "Quiet Derby")
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    _record(db, _heat(db, race, round_one, racers), 2.98)

    stats = await _timing_stats(db, race.id)
    assert stats.record_break is None


@pytest.mark.anyio
async def test_an_exhibition_run_never_breaks_the_record(db, group, track):
    # Dad's car beating the record is a story for the room, not a headline
    # on the board — a free heat cannot hold a record, so it cannot break
    # one.
    _historical(db, track.id, 3.05)
    race = _race(db, group, track, "Exhibition Derby")
    racers = _racers(db, race)
    free = crud.create_free_race_heat(
        db,
        race.id,
        as_lanes([{"lane": 1, "racer_id": racers[0].id}]),
    )
    _record(db, free, 2.5)

    stats = await _timing_stats(db, race.id)
    assert stats.round_name == "Exhibition"
    assert stats.record_break is None
