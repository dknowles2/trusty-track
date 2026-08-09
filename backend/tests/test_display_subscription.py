"""A display registers by subscribing, and is told what to show (#174).

The registration path is the interesting one, and it is forced rather than
chosen: a screen holds no PIN and is a `VIEWER`, and a `VIEWER` may make no
mutation at all (#15). So presence cannot be announced by calling one. The
subscription the display already holds does it.

That makes the lifecycle the thing to test — a screen appears when it
subscribes, stays listed when it goes quiet, and receives an assignment made
while it was connected.
"""

import asyncio

import pytest

import backend.api.schema as schema_mod
from backend.api.pubsub import _PubSub
from backend.api.schema import Mutation, Query, Subscription
from backend.domain.displays import DisplayView
from backend.services.displays import registry

TIMEOUT = 2.0


@pytest.fixture(autouse=True)
def isolated_pubsub(monkeypatch):
    """A private bus per test — the singleton is shared with the app."""
    bus = _PubSub()
    monkeypatch.setattr(schema_mod, "pubsub", bus)
    return bus


@pytest.fixture(autouse=True)
def empty_registry():
    """The registry is a process-wide singleton, like the timer managers."""
    registry.clear()
    yield
    registry.clear()


async def _first(agen):
    return await asyncio.wait_for(agen.__anext__(), timeout=TIMEOUT)


@pytest.mark.asyncio
async def test_subscribing_registers_the_display():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)

    first = await _first(stream)

    assert first.display_id == "abc"
    assert [d.display_id for d in Query().displays(race_id=1)] == ["abc"]
    await stream.aclose()


@pytest.mark.asyncio
async def test_the_opening_payload_carries_the_default_view():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)

    first = await _first(stream)

    assert first.view is DisplayView.STANDINGS
    assert first.description
    await stream.aclose()


@pytest.mark.asyncio
async def test_an_assignment_reaches_a_connected_display():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    await Mutation().assign_display(view=DisplayView.PROJECTOR, display_id="abc")

    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert payload.view is DisplayView.PROJECTOR
    await stream.aclose()


@pytest.mark.asyncio
async def test_the_display_is_registered_before_its_opening_payload():
    """The window `test_subscription_snapshot_race.py` exists for.

    `pubsub.subscribe` registers the queue on entry, so an assignment made
    before that reaches nothing. Here the danger is narrower and worse: if
    registration happened *after* the first yield, an operator who assigned in
    that window would be told the display does not exist, and the screen would
    sit on the wrong view for the rest of the event.

    Asserting the mutation *finds* the display before the payload is drained is
    what pins the ordering.
    """
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    first = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)

    assigned = await Mutation().assign_display(
        view=DisplayView.TIMING, display_id="abc"
    )

    assert assigned is not None, "the display was not registered before it was told"
    await asyncio.wait_for(first, timeout=TIMEOUT)
    await stream.aclose()


@pytest.mark.asyncio
async def test_closing_the_socket_marks_the_display_quiet_but_keeps_it():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)

    await stream.aclose()

    listed = Query().displays(race_id=1)
    assert [d.display_id for d in listed] == ["abc"]
    assert listed[0].connected is False


@pytest.mark.asyncio
async def test_a_reconnecting_display_keeps_what_it_was_told():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)
    await Mutation().assign_display(view=DisplayView.CYCLE, display_id="abc")
    await Mutation().rename_display(display_id="abc", name="Gym north")
    await stream.aclose()

    again = Subscription().display_assignment(display_id="abc", race_id=1)
    payload = await _first(again)

    assert payload.view is DisplayView.CYCLE
    assert payload.name == "Gym north"
    await again.aclose()


@pytest.mark.asyncio
async def test_the_operator_list_updates_when_a_display_arrives():
    listing = Subscription().displays(race_id=1)
    assert await _first(listing) == []

    following = asyncio.create_task(listing.__anext__())
    await asyncio.sleep(0.05)
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)

    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert [d.display_id for d in payload] == ["abc"]
    await stream.aclose()
    await listing.aclose()


@pytest.mark.asyncio
async def test_assigning_a_display_nobody_has_seen_reports_it():
    assert (
        await Mutation().assign_display(view=DisplayView.TIMING, display_id="ghost")
    ) is None


@pytest.mark.asyncio
async def test_an_interval_below_a_second_is_refused():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)

    with pytest.raises(ValueError):
        await Mutation().assign_display(
            view=DisplayView.CYCLE, display_id="abc", cycle_seconds=0
        )
    await stream.aclose()


@pytest.mark.asyncio
async def test_forgetting_a_display_removes_it_from_the_list():
    stream = Subscription().display_assignment(display_id="abc", race_id=1)
    await _first(stream)
    await stream.aclose()

    assert await Mutation().forget_display(display_id="abc") is True
    assert Query().displays(race_id=1) == []
