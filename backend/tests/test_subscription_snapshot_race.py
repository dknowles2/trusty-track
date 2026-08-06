"""A subscription's first payload must not be sent before it is subscribed.

`pubsub.subscribe` registers the queue on entry, so anything published before
that reaches no queue at all. Three subscriptions built their opening snapshot
*first* and subscribed afterwards, leaving a window — a database query wide —
in which an update was dropped silently. Every payload these emit is a full
snapshot rather than a delta, so nothing catches up: the client renders the
pre-change state and keeps it until some later, unrelated event happens to
arrive.

`heatSession` is the one that bit. The operator screen arms the heat itself, so
the arming lands squarely inside its own subscription's window: the screen sat
at "Waiting for Timer…" with the start button disabled while the timer was in
fact ARMED. Found by the race-day end-to-end spec, which fails only when the
page loads fast enough to beat the socket.

Each test here takes the opening snapshot, *then* publishes. Without the fix
the generator is still suspended at its first `yield` when the publish happens,
resumes into `pubsub.subscribe` after the payload is gone, and blocks forever —
which is a timeout rather than a wrong value.

The existing subscription tests could not have caught this: they run the
trigger concurrently with the drain after a 50 ms sleep, by which time the
subscription has long since subscribed.
"""

import asyncio

import pytest

import backend.api.schema as schema_mod
from backend.api.pubsub import _PubSub
from backend.api.schema import Subscription
from backend.db import crud, models, schemas
from backend.domain import lanes
from backend.services.timer.devices import FAKE
from backend.services.timer.manager import TimerManager

#: Long enough that a real scheduling hiccup is not mistaken for the bug, short
#: enough that a failure says so promptly.
TIMEOUT = 2.0


@pytest.fixture(autouse=True)
def isolated_pubsub(monkeypatch):
    """A private bus per test — the singleton is shared with the app."""
    bus = _PubSub()
    monkeypatch.setattr(schema_mod, "pubsub", bus)
    return bus


def _race(db, label):
    group = crud.create_group(db, schemas.GroupCreate(name=f"{label} Group"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"{label} Track", lane_count=2, timer_type="FAKE"),
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
    return race, track


def _heat(db, race, lane_count=2):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    racers = [
        crud.create_racer(
            db, schemas.RacerCreate(first_name=n, last_name="R", race_id=race.id)
        )
        for n in ("Ava", "Ben")[:lane_count]
    ]
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    crud.set_heat_lanes(
        heat,
        [lanes.Lane(lane=i + 1, racer_id=r.id) for i, r in enumerate(racers)],
    )
    db.add(heat)
    db.commit()
    return heat


def _info(db, managers=None):
    class MockInfo:
        context = {"db": db, "timer_managers": managers or {}}

    return MockInfo()


async def _next(stream):
    """One payload. Spelt out because `anext` is 3.10+ and the floor is 3.9."""
    return await stream.__anext__()


@pytest.mark.anyio
async def test_heat_session_does_not_drop_an_arming_published_after_its_snapshot(
    db, isolated_pubsub
):
    """The one that stranded the operator screen.

    The screen's own `prepareHeat` is what publishes here, which is why this
    window is not merely theoretical — the mutation is fired from the first
    render, right as the socket is opening.
    """
    race, track = _race(db, "Session")
    heat = _heat(db, race)
    manager = TimerManager(track_id=track.id, device=FAKE)

    stream = Subscription().heat_session(
        _info(db, {track.id: manager}), track.id, heat.id
    )
    opening = await _next(stream)
    assert opening.timer_state == "IDLE"

    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )
    await isolated_pubsub.publish(f"timer_state:{track.id}", manager.status())

    armed = await asyncio.wait_for(_next(stream), timeout=TIMEOUT)
    assert armed.timer_state == "ARMED"


@pytest.mark.anyio
async def test_heat_session_watches_the_race_channel_from_the_snapshot_on(
    db, isolated_pubsub
):
    """The second channel has to be registered by then too.

    A result saved in the same window is what turns RUNNING into RECORDED, and
    it never comes from the timer — so losing it leaves the screen claiming a
    heat is still racing while its times are in the standings.
    """
    race, track = _race(db, "SessionRace")
    heat = _heat(db, race)

    stream = Subscription().heat_session(_info(db), track.id, heat.id)
    await _next(stream)

    await isolated_pubsub.publish(f"race_state:{race.id}", None)

    await asyncio.wait_for(_next(stream), timeout=TIMEOUT)


@pytest.mark.anyio
async def test_timer_status_does_not_drop_a_transition_after_its_snapshot(
    db, isolated_pubsub
):
    race, track = _race(db, "Status")
    heat = _heat(db, race)
    manager = TimerManager(track_id=track.id, device=FAKE)

    stream = Subscription().timer_status(_info(db, {track.id: manager}), track.id)
    opening = await _next(stream)
    assert opening.status.state == "IDLE"

    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )
    await isolated_pubsub.publish(f"timer_state:{track.id}", manager.status())

    armed = await asyncio.wait_for(_next(stream), timeout=TIMEOUT)
    assert armed.status.state == "ARMED"


@pytest.mark.anyio
async def test_free_race_heat_does_not_drop_a_result_after_its_snapshot(
    db, isolated_pubsub
):
    race, _ = _race(db, "Free")
    free_heat = crud.create_free_race_heat(db, race.id, [lanes.Lane(lane=1)])

    stream = Subscription().free_race_heat(_info(db), free_heat.id)
    opening = await _next(stream)
    assert opening is not None and opening.id == free_heat.id

    await isolated_pubsub.publish(f"race_state:{race.id}", None)

    await asyncio.wait_for(_next(stream), timeout=TIMEOUT)


@pytest.mark.anyio
async def test_free_race_heat_still_answers_for_a_heat_that_is_not_there(db):
    """It has no channel to watch, so it says so once and stops rather than
    leaving the client waiting on a stream that will never carry anything."""
    stream = Subscription().free_race_heat(_info(db), 9999)

    assert await _next(stream) is None
    with pytest.raises(StopAsyncIteration):
        await _next(stream)
