"""Which heat the timing display calls "the one that just ran" — issue #59.

There are two kinds of heat in one table and they are not comparable on
anything the schedule knows. Official heats order by round and heat number,
which says nothing about *when*; free heats have no round at all. The resolver
used to resolve that by preferring official heats whenever any had a time, which
made an exhibition run unreachable from the first result of the day onward.

`recorded_at` is the answer to "when was this saved", and it is the only field
the two kinds can be ranked on together.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.domain import lanes
from backend.tests.helpers import as_lanes


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=2, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racers(db, race):
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
        for name in ("Alice", "Bob")
    ]


@pytest.fixture
def round_one(db, race):
    return crud.create_round(db, race_id=race.id, round_number=1)


def _official(db, race, round_obj, racers, heat_number):
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=heat_number,
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racers[0].id, "time": None, "place": None},
                {"lane": 2, "racer_id": racers[1].id, "time": None, "place": None},
            ]
        ),
    )
    db.add(heat)
    db.commit()
    return heat


def _free(db, race, racers):
    heat = models.Heat(
        race_id=race.id,
        round_id=None,
        kind=models.HeatKind.FREE,
        heat_number=1,
        created_at="2020-01-01T00:00:00Z",
        lane_results=json.dumps(
            [{"lane": 1, "racer_id": racers[0].id, "time": None, "place": None}]
        ),
    )
    db.add(heat)
    db.commit()
    return heat


def _record(db, heat, seconds):
    """Record through crud, which is what stamps `recorded_at`."""
    heat_lanes = lanes.parse(heat.lane_results)
    for index, lane in enumerate(heat_lanes):
        lane.time = seconds + index / 10
        lane.place = index + 1
    if heat.kind is models.HeatKind.FREE:
        crud.update_free_race_heat_result(
            db, heat.id, as_lanes([lane.to_dict() for lane in heat_lanes])
        )
    else:
        crud.record_heat_result(db, heat.id, heat_lanes)


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
async def test_an_exhibition_run_after_an_official_heat_is_what_shows(
    db, race, racers, round_one
):
    """The bug: from the first official result onward, free heats were dead.

    The resolver has an `is_free` branch — "Exhibition", heat number 0 — that
    could not be reached during a race.
    """
    official = _official(db, race, round_one, racers, 1)
    _record(db, official, 3.0)

    free = _free(db, race, racers)
    _record(db, free, 2.5)

    stats = await _timing_stats(db, race.id)

    assert stats is not None
    assert stats.heat_id == free.id
    assert stats.round_name == "Exhibition"


@pytest.mark.anyio
async def test_an_official_heat_run_after_an_exhibition_one_takes_it_back(
    db, race, racers, round_one
):
    """The other direction, which is the common one — the display must not now
    stick on the exhibition run instead."""
    free = _free(db, race, racers)
    _record(db, free, 2.5)

    official = _official(db, race, round_one, racers, 1)
    _record(db, official, 3.0)

    stats = await _timing_stats(db, race.id)

    assert stats is not None
    assert stats.heat_id == official.id


@pytest.mark.anyio
async def test_re_recording_an_earlier_heat_brings_it_forward(
    db, race, racers, round_one
):
    """Correcting heat 1 after heat 2 has run makes heat 1 the last thing saved.

    Schedule order got this wrong too, independently of free heats: it would
    keep showing heat 2 while the operator was fixing heat 1 in front of them.
    """
    first = _official(db, race, round_one, racers, 1)
    second = _official(db, race, round_one, racers, 2)
    _record(db, first, 3.0)
    _record(db, second, 3.5)
    assert (await _timing_stats(db, race.id)).heat_id == second.id

    _record(db, first, 4.0)

    assert (await _timing_stats(db, race.id)).heat_id == first.id


@pytest.mark.anyio
async def test_a_heat_with_no_results_is_never_the_target(db, race, racers, round_one):
    _official(db, race, round_one, racers, 1)

    assert await _timing_stats(db, race.id) is None


def test_recording_stamps_the_heat(db, race, racers, round_one):
    heat = _official(db, race, round_one, racers, 1)
    assert heat.recorded_at is None

    _record(db, heat, 3.0)

    assert heat.recorded_at is not None


def test_clearing_a_result_unstamps_it(db, race, racers, round_one):
    """Re-running a heat clears its lanes. It has not been recorded any more,
    and leaving the stamp would keep it at the head of the running order."""
    heat = _official(db, race, round_one, racers, 1)
    _record(db, heat, 3.0)
    assert heat.recorded_at is not None

    cleared = [
        {"lane": lane.lane, "racer_id": lane.racer_id, "time": None, "place": None}
        for lane in lanes.parse(heat.lane_results)
    ]
    crud.record_heat_result(db, heat.id, as_lanes(cleared))

    assert heat.recorded_at is None


def test_a_free_heat_is_stamped_too(db, race, racers):
    heat = _free(db, race, racers)
    assert heat.recorded_at is None

    _record(db, heat, 2.5)

    assert heat.recorded_at is not None


@pytest.mark.anyio
async def test_unstamped_rows_fall_back_to_schedule_order(db, race, racers, round_one):
    """What an upgraded database looks like before its next result.

    Every existing row holds null, so the ranking degrades to the old rule:
    latest official heat by schedule order, and free heats (no round) behind
    them. The upgrade changes nothing until something is recorded.
    """
    first = _official(db, race, round_one, racers, 1)
    second = _official(db, race, round_one, racers, 2)
    free = _free(db, race, racers)
    for heat in (first, second, free):
        _record(db, heat, 3.0)
        heat.recorded_at = None
    db.commit()

    stats = await _timing_stats(db, race.id)

    assert stats is not None
    assert stats.heat_id == second.id
