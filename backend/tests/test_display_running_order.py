"""What the audience displays call "now" and "next" — issue #55.

`currentlyRacing` and `onDeck` walk the race's heats in order and take the first
two that are not finished. The question they were asking was whether lane *0* of
the blob held a time, which is wrong twice over: it ignores `skipped`, and it
ignores every lane but the first.

Both mistakes strand the displays on a heat the race has moved past, and neither
is recoverable from the operator screen — hence heats here with more than one
lane, which is what the pre-existing subscription tests lack.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.domain import lanes


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
                last_name="Test",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for name in ("Alice", "Bob", "Cara", "Dan")
    ]


@pytest.fixture
def two_heats(db, race, racers):
    """Two two-lane heats in one round. Heat 1 is unrun; the caller sets it."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heats = []
    for number, (left, right) in enumerate([(0, 1), (2, 3)], start=1):
        heat = models.Heat(
            race_id=race.id,
            round_id=round_obj.id,
            heat_number=number,
            lane_results=json.dumps(
                [
                    {
                        "lane": 1,
                        "racer_id": racers[left].id,
                        "time": None,
                        "place": None,
                    },
                    {
                        "lane": 2,
                        "racer_id": racers[right].id,
                        "time": None,
                        "place": None,
                    },
                ]
            ),
        )
        db.add(heat)
        heats.append(heat)
    db.commit()
    return heats


def _skip(db, heat):
    """What `RaceExecution.handleSkipHeat` writes: no times, `skipped` set."""
    heat_lanes = lanes.parse(heat.lane_results)
    for lane in heat_lanes:
        lane.time = None
        lane.place = None
        lane.extra["skipped"] = True
    heat.lane_results = lanes.serialize(heat_lanes)
    db.commit()


def _empty_lane_one(db, heat, racers):
    """A heat that ran, whose lane 1 racer was later deleted.

    `crud._remove_racer_from_regular_heats` nullifies the lane rather than
    dropping it, so lane 1 ends up holding no racer and no time.
    """
    heat.lane_results = json.dumps(
        [
            {"lane": 1, "racer_id": None, "time": None, "place": None},
            {"lane": 2, "racer_id": racers[1].id, "time": 3.4, "place": 1},
        ]
    )
    db.commit()


async def _first(db, name, race_id):
    """The subscription's opening value, which is the query under test."""
    from backend.api.schema import Subscription

    class MockInfo:
        context = {"db": db}

    generator = getattr(Subscription(), name)(MockInfo(), race_id)
    try:
        return await generator.__anext__()
    finally:
        await generator.aclose()


@pytest.mark.anyio
async def test_a_skipped_heat_is_not_currently_racing(db, race, two_heats):
    """The operator passed over heat 1, so heat 2 is on the track.

    Left unfixed this pins the display to heat 1 for the rest of the event: no
    later result can put a time in it, so it never leaves the head of the list.
    """
    _skip(db, two_heats[0])

    current = await _first(db, "currently_racing", race.id)

    assert current is not None
    assert current.id == two_heats[1].id


@pytest.mark.anyio
async def test_nothing_is_on_deck_behind_a_skipped_heat(db, race, two_heats):
    """Heat 2 is racing and there is no heat 3, so on deck is empty.

    The bug returned heat 2's racers here — the ones actually on the track.
    """
    _skip(db, two_heats[0])

    assert await _first(db, "on_deck", race.id) == []


@pytest.mark.anyio
async def test_a_heat_whose_first_lane_is_empty_still_counts_as_run(
    db, race, racers, two_heats
):
    """Lane 2 holds a time, which is enough. Lane 1 holding nobody is not a
    reason to send the displays back to a heat that has been raced."""
    _empty_lane_one(db, two_heats[0], racers)

    current = await _first(db, "currently_racing", race.id)

    assert current is not None
    assert current.id == two_heats[1].id


@pytest.mark.anyio
async def test_an_unrun_heat_is_still_currently_racing(db, race, two_heats):
    """The other direction: nothing recorded and nothing skipped means heat 1
    is up, and heat 2 is on deck. A predicate that called everything finished
    would pass the three tests above."""
    current = await _first(db, "currently_racing", race.id)
    on_deck = await _first(db, "on_deck", race.id)

    assert current is not None
    assert current.id == two_heats[0].id
    assert [racer.first_name for racer in on_deck] == ["Cara", "Dan"]


@pytest.mark.anyio
async def test_a_skipped_heat_has_no_timing_stats(db, race, two_heats):
    """`timingStats` shows a heat's results, so it wants times rather than
    `is_finished` — a skipped heat has nothing to display."""
    _skip(db, two_heats[0])

    assert await _first(db, "timing_stats", race.id) is None


@pytest.mark.anyio
async def test_timing_stats_report_every_lane_of_the_last_run_heat(db, race, two_heats):
    heat_lanes = lanes.parse(two_heats[0].lane_results)
    heat_lanes[0].time, heat_lanes[0].place = 3.1, 1
    heat_lanes[1].time, heat_lanes[1].place = 3.2, 2
    two_heats[0].lane_results = lanes.serialize(heat_lanes)
    db.commit()

    stats = await _first(db, "timing_stats", race.id)

    assert stats is not None
    assert stats.heat_id == two_heats[0].id
    assert [(lane.lane_number, lane.time) for lane in stats.lanes] == [
        (1, 3.1),
        (2, 3.2),
    ]
    assert [lane.racer_name for lane in stats.lanes] == ["Alice Test", "Bob Test"]


@pytest.mark.anyio
async def test_timing_stats_read_a_time_stored_as_a_string(db, race, two_heats):
    """The frontend has written `time` as a string, and `lane_results` keeps it
    as it was found. The GraphQL field is a Float, so the resolver has to be the
    thing that converts."""
    heat_lanes = lanes.parse(two_heats[0].lane_results)
    heat_lanes[0].time, heat_lanes[0].place = "3.45", 1
    two_heats[0].lane_results = lanes.serialize(heat_lanes)
    db.commit()

    stats = await _first(db, "timing_stats", race.id)

    assert stats is not None
    assert stats.lanes[0].time == 3.45


def test_placeholder_slots_are_not_scheduled_racers(db, race, racers, two_heats):
    """`scheduledRacerIds` is who is in the schedule. An undecided championship
    slot is a negative id, and no racer is in it yet."""
    from backend.api.loaders import RequestLoaders

    two_heats[1].lane_results = json.dumps(
        [
            {"lane": 1, "racer_id": -1, "time": None, "place": None},
            {"lane": 2, "racer_id": -2, "time": None, "place": None},
        ]
    )
    db.commit()

    scheduled = RequestLoaders(db).scheduled_racer_ids(race.id)

    assert scheduled == sorted([racers[0].id, racers[1].id])
