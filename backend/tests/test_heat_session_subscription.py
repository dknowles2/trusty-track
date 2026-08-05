"""`heatSession` as a subscription — issue #7, step two.

The query proved the assembly. This proves the two things a subscription adds,
both of which are easy to get wrong and silent when wrong:

- it watches **two** sources, because a result being saved is what turns
  RUNNING into RECORDED and that never comes from the timer;
- it re-reads the database on every event. A subscription holds one session for
  the whole connection, so without an explicit expire it answers forever from
  rows loaded when the socket opened.

Also covers `pubsub.subscribe` taking several channels, which step two added
for exactly this.
"""

import asyncio
import json

import pytest
from sqlalchemy.orm import Session

import backend.api.schema as schema_mod
from backend.api.pubsub import _PubSub
from backend.api.schema import Subscription, _publish_race_state
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager


@pytest.fixture(autouse=True)
def isolated_pubsub(monkeypatch):
    """A private bus per test.

    The module-level singleton is shared with the app and with any subscriber a
    previous test left running, so a test that counts events has to own one.
    """
    bus = _PubSub()
    monkeypatch.setattr(schema_mod, "pubsub", bus)
    return bus


def _race(db, lane_count=2, label="Sub"):
    """`label` because `groups.name` is unique and one test seeds two races."""
    group = crud.create_group(db, schemas.GroupCreate(name=f"{label} Group"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name=f"{label} Track", lane_count=lane_count, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    racers = [
        crud.create_racer(
            db, schemas.RacerCreate(first_name=n, last_name="R", race_id=race.id)
        )
        for n in ("Ava", "Ben")
    ]
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racers[0].id, "time": None, "place": None},
                {"lane": 2, "racer_id": racers[1].id, "time": None, "place": None},
            ]
        ),
    )
    db.add(heat)
    db.commit()
    return race, track, heat, racers


def _info(db, managers=None):
    class MockInfo:
        context = {"db": db, "timer_managers": managers or {}}

    return MockInfo()


async def _next(stream):
    """One payload. Spelt out because `anext` is 3.10+ and the project still
    declares `requires-python = ">=3.9"`."""
    return await stream.__anext__()


async def _collect(subscription, count, trigger, timeout=2.0):
    """Take *count* events off *subscription* while *trigger* runs."""
    collected = []

    async def _drain():
        async for event in subscription:
            collected.append(event)
            if len(collected) == count:
                break

    await asyncio.wait_for(asyncio.gather(_drain(), trigger()), timeout=timeout)
    return collected


# --------------------------------------------------------------------------- #
# The stream                                                                   #
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_the_current_session_arrives_without_waiting_for_an_event(db):
    """A screen that has just connected needs the state now, not at the next
    lane time."""
    _, track, heat, racers = _race(db)

    collected = await _collect(
        Subscription().heat_session(_info(db), track.id, heat.id),
        1,
        lambda: asyncio.sleep(0),
    )

    assert collected[0].heat_id == heat.id
    assert collected[0].phase is schema_mod.domain_heat_session.Phase.WAITING
    assert [lane.racer_id for lane in collected[0].lanes] == [r.id for r in racers]


@pytest.mark.anyio
async def test_a_lane_time_from_the_timer_produces_a_new_session(db, isolated_pubsub):
    _, track, heat, racers = _race(db)
    manager = TimerManager(track_id=track.id, device=FAKE)
    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )

    async def trigger():
        await asyncio.sleep(0.05)
        await manager.inject_event(RaceStarted())
        await manager.inject_event(LaneResult(lane=1, time_seconds=3.101, place=1))
        await isolated_pubsub.publish(f"timer_state:{track.id}", manager.status())

    collected = await _collect(
        Subscription().heat_session(_info(db, {track.id: manager}), track.id, heat.id),
        2,
        trigger,
    )

    assert not any(lane.pending for lane in collected[0].lanes)
    live = collected[-1]
    assert live.phase is schema_mod.domain_heat_session.Phase.RUNNING
    assert (live.lanes[0].time, live.lanes[0].pending) == (3.101, True)


@pytest.mark.anyio
async def test_a_saved_result_produces_a_new_session(db):
    """The reason the race channel is watched at all.

    Nothing about the timer changes when a result lands — this event comes from
    the mutation. Watching only `timer_state` would leave the operator screen
    showing RUNNING over a heat that is in the standings.
    """
    race, track, heat, racers = _race(db)

    async def trigger():
        await asyncio.sleep(0.05)
        crud.record_heat_result(
            db,
            heat.id,
            json.dumps(
                [
                    {"lane": 1, "racer_id": racers[0].id, "time": 3.4, "place": 1},
                    {"lane": 2, "racer_id": racers[1].id, "time": 3.5, "place": 2},
                ]
            ),
        )
        await _publish_race_state(race.id)

    collected = await _collect(
        Subscription().heat_session(_info(db), track.id, heat.id), 2, trigger
    )

    assert collected[0].phase is schema_mod.domain_heat_session.Phase.WAITING
    assert collected[-1].phase is schema_mod.domain_heat_session.Phase.RECORDED
    assert [lane.time for lane in collected[-1].lanes] == [3.4, 3.5]


@pytest.mark.anyio
async def test_the_session_is_re_read_rather_than_replayed(db):
    """The stale-data trap `expire_all()` and `_loaders(info).clear()` exist for.

    The write has to come from **another session** for this to prove anything.
    Writing through the subscription's own session updates its identity map on
    the way past, so the expire is a no-op and the test passes whether or not
    the code is there — which is how the first version of this test was wrong.
    `TimerManager` genuinely writes from its own `SessionLocal()`, outside the
    request lifecycle, so the stale case is the real one.
    """
    race, track, heat, racers = _race(db)
    heat_id, racer_id = heat.id, racers[0].id

    # Load the heat into the subscription's session so it has something stale.
    assert db.query(models.Heat).filter(models.Heat.id == heat_id).one().lane_results

    writer = Session(bind=db.get_bind())

    async def trigger():
        await asyncio.sleep(0.05)
        crud.record_heat_result(
            writer,
            heat_id,
            json.dumps([{"lane": 1, "racer_id": racer_id, "time": 9.1, "place": 1}]),
        )
        await _publish_race_state(race.id)

    try:
        collected = await _collect(
            Subscription().heat_session(_info(db), track.id, heat_id), 2, trigger
        )
    finally:
        writer.close()

    assert collected[0].lanes[0].time is None
    assert collected[-1].lanes[0].time == 9.1


@pytest.mark.anyio
async def test_a_result_in_another_race_does_not_wake_this_track(db):
    """The race channel is resolved from *this* heat, not subscribed globally."""
    _, track, heat, _ = _race(db)
    other_race, _, _, _ = _race(db, label="Other")

    async def trigger():
        await asyncio.sleep(0.05)
        await _publish_race_state(other_race.id)
        await asyncio.sleep(0.1)

    with pytest.raises(asyncio.TimeoutError):
        await _collect(
            Subscription().heat_session(_info(db), track.id, heat.id),
            2,
            trigger,
            timeout=0.5,
        )


# --------------------------------------------------------------------------- #
# pubsub taking several channels                                               #
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_one_stream_receives_from_every_channel():
    bus = _PubSub()
    async with bus.subscribe("a", "b") as stream:
        await bus.publish("a", 1)
        await bus.publish("b", 2)
        assert [await _next(stream), await _next(stream)] == [1, 2]


@pytest.mark.anyio
async def test_leaving_removes_the_queue_from_every_channel():
    """A leak here is invisible until the process runs out of memory: the queue
    stays registered and every later publish fills it forever."""
    bus = _PubSub()
    async with bus.subscribe("a", "b"):
        assert [len(bus._subscribers[c]) for c in ("a", "b")] == [1, 1]
    assert [len(bus._subscribers[c]) for c in ("a", "b")] == [0, 0]


@pytest.mark.anyio
async def test_a_single_channel_still_works():
    bus = _PubSub()
    async with bus.subscribe("only") as stream:
        await bus.publish("only", "payload")
        assert await _next(stream) == "payload"
    assert bus._subscribers["only"] == []
