"""Stage 4 of #610: the two payloads that actually carry a computed speed.

`TimingStatsLane.scaleMph` and `RaceStats.topScaleMph` both wrap
`domain.scale_speed.scale_mph` — the same "compute once, server-side" rule
`timing_stats` already follows for a lane's display name (#552). Both are
null under the same three conditions: `Track.show_scale_speed` is off, the
track has no positive `length_feet`, or there is no time to convert.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.services import stats as race_stats_module
from backend.tests.helpers import as_lanes


@pytest.fixture
def group(db):
    return crud.create_organization(db, schemas.OrganizationCreate(name="Speed Pack"))


def _track(db, **overrides):
    fields = {"name": "Speed Track", "lane_count": 2, "timer_type": "FAKE"}
    fields.update(overrides)
    return crud.create_track(db, schemas.TrackCreate(**fields))


def _race(db, group, track, name="Speed Derby"):
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


def _record(db, heat, seconds_by_racer_index):
    heat_lanes = crud.heat_lanes_of(db, heat)
    heat_lanes.sort(key=lambda lane: lane.lane)
    for index, lane in enumerate(heat_lanes):
        lane.time = seconds_by_racer_index[index]
        lane.place = index + 1
    crud.record_heat_result(db, heat.id, heat_lanes, source=audit.ResultSource.OPERATOR)


async def _timing_stats(db, race_id):
    from backend.api.schema import Subscription

    class MockInfo:
        context = {"db": db}

    generator = Subscription().timing_stats(MockInfo(), race_id)
    try:
        return await generator.__anext__()
    finally:
        await generator.aclose()


# --- TimingStatsLane.scaleMph ---


@pytest.mark.anyio
async def test_the_worked_example_on_a_configured_track(db, group):
    # 40 ft / 3.200 s / scale 25 -> ~213.1 mph (the domain layer's own
    # worked example, reached this time through the subscription payload).
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    stats = await _timing_stats(db, race.id)
    by_lane = {lane.lane_number: lane for lane in stats.lanes}
    assert by_lane[1].scale_mph is not None
    assert round(by_lane[1].scale_mph, 1) == 213.1


@pytest.mark.anyio
async def test_show_scale_speed_off_hides_it(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=False)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    stats = await _timing_stats(db, race.id)
    assert all(lane.scale_mph is None for lane in stats.lanes)


@pytest.mark.anyio
async def test_a_zero_length_track_hides_it(db, group):
    # `length_feet` defaults to null (#610 stage 2 leaves an existing track
    # unconfigured); a track saved with an explicit 0 is the same "nothing
    # to compute from" case.
    track = _track(db, length_feet=0, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    stats = await _timing_stats(db, race.id)
    assert all(lane.scale_mph is None for lane in stats.lanes)


@pytest.mark.anyio
async def test_no_length_at_all_hides_it(db, group):
    track = _track(db, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    stats = await _timing_stats(db, race.id)
    assert all(lane.scale_mph is None for lane in stats.lanes)


@pytest.mark.anyio
async def test_a_dnf_lane_has_no_speed_even_on_a_configured_track(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [0.0, 3.500])

    stats = await _timing_stats(db, race.id)
    by_lane = {lane.lane_number: lane for lane in stats.lanes}
    assert by_lane[1].scale_mph is None
    assert by_lane[2].scale_mph is not None


# --- RaceStats.topScaleMph ---


def test_top_scale_mph_matches_the_fastest_heat(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    data = race_stats_module.compute_race_stats(db, race.id)
    assert data is not None
    assert data["top_scale_mph"] is not None
    assert round(data["top_scale_mph"], 1) == 213.1


def test_top_scale_mph_is_null_with_the_flag_off(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=False)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    data = race_stats_module.compute_race_stats(db, race.id)
    assert data is not None
    assert data["top_scale_mph"] is None


def test_top_scale_mph_is_null_with_no_length(db, group):
    track = _track(db, show_scale_speed=True)
    race = _race(db, group, track)
    racers = _racers(db, race)
    round_one = crud.create_round(db, race_id=race.id, round_number=1)
    heat = _heat(db, race, round_one, racers)
    _record(db, heat, [3.200, 3.500])

    data = race_stats_module.compute_race_stats(db, race.id)
    assert data is not None
    assert data["top_scale_mph"] is None


def test_top_scale_mph_is_null_before_any_heat_finishes(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track)
    _racers(db, race)
    crud.create_round(db, race_id=race.id, round_number=1)

    data = race_stats_module.compute_race_stats(db, race.id)
    assert data is not None
    assert data["top_scale_mph"] is None


def test_top_scale_mph_is_null_with_no_track(db, group):
    track = _track(db, length_feet=40, scale_ratio=25, show_scale_speed=True)
    race = _race(db, group, track, name="Trackless Derby")
    race.track_id = None
    db.commit()
    _racers(db, race)
    crud.create_round(db, race_id=race.id, round_number=1)

    data = race_stats_module.compute_race_stats(db, race.id)
    assert data is not None
    assert data["top_scale_mph"] is None
