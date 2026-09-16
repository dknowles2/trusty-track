"""A camera is a display with a role, not a different kind of device (#177
stage 1a).

`domain.displays.DisplayRole`, the `role`/`trackId`/`lastClipAt` fields on
`services.displays.Display`, and the `setCameraTrack` mutation. The camera
registers through the exact same `displayAssignment` subscription an
ordinary screen does — see `test_display_subscription.py` for that
subscription's own lifecycle tests, which this file does not repeat.
"""

import asyncio

import pytest

from backend.api.schema import Mutation, Query, Subscription
from backend.domain.displays import DisplayRole
from backend.services.displays import registry

TIMEOUT = 2.0


@pytest.fixture(autouse=True)
def empty_registry():
    registry.clear()
    yield
    registry.clear()


def _info(db):
    class MockInfo:
        context = {"db": db, "timer_managers": {}}

    return MockInfo()


async def _first(agen):
    return await asyncio.wait_for(agen.__anext__(), timeout=TIMEOUT)


async def test_a_camera_registers_with_its_role(db):
    stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )

    first = await _first(stream)

    assert first.role is DisplayRole.CAMERA
    assert first.track_id is None
    await stream.aclose()


async def test_an_ordinary_display_defaults_to_the_display_role(db):
    stream = Subscription().display_assignment(_info(db), display_id="scr-1", race_id=1)

    first = await _first(stream)

    assert first.role is DisplayRole.DISPLAY
    await stream.aclose()


async def test_the_role_survives_a_reconnect(db):
    """A browser tab does not change what page it is between reloads —
    `DisplayRegistry.connect` writes `role` on every connect, but every real
    caller passes the same one every time, so a reconnect never flips it."""
    first_stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )
    await _first(first_stream)
    await first_stream.aclose()

    second_stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )
    second = await _first(second_stream)

    assert second.role is DisplayRole.CAMERA
    await second_stream.aclose()


async def test_the_operators_list_shows_camera_and_display_roles(db):
    display_stream = Subscription().display_assignment(
        _info(db), display_id="scr-1", race_id=1
    )
    await _first(display_stream)
    camera_stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )
    await _first(camera_stream)

    roles = {d.display_id: d.role for d in Query().displays(race_id=1)}

    assert roles == {"scr-1": DisplayRole.DISPLAY, "cam-1": DisplayRole.CAMERA}
    await display_stream.aclose()
    await camera_stream.aclose()


async def test_set_camera_track_picks_a_track(db):
    stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )
    await _first(stream)

    result = await Mutation().set_camera_track(display_id="cam-1", track_id=42)

    assert result is not None
    assert result.track_id == 42
    await stream.aclose()


async def test_set_camera_track_refuses_an_ordinary_display(db):
    stream = Subscription().display_assignment(_info(db), display_id="scr-1", race_id=1)
    await _first(stream)

    result = await Mutation().set_camera_track(display_id="scr-1", track_id=42)

    assert result is None
    await stream.aclose()


async def test_set_camera_track_refuses_an_unseen_display():
    result = await Mutation().set_camera_track(display_id="ghost", track_id=1)

    assert result is None


# --------------------------------------------------------------------------- #
# The `replays` toggle                                                        #
# --------------------------------------------------------------------------- #


async def test_replays_defaults_to_on(db):
    stream = Subscription().display_assignment(_info(db), display_id="scr-1", race_id=1)

    first = await _first(stream)

    assert first.replays is True
    await stream.aclose()


async def test_replays_can_be_turned_off_and_on(db):
    stream = Subscription().display_assignment(_info(db), display_id="scr-1", race_id=1)
    await _first(stream)

    from backend.domain.displays import DisplayView

    off = await Mutation().assign_display(
        view=DisplayView.STANDINGS, display_id="scr-1", replays=False
    )
    assert off.replays is False

    # Omitted means "leave alone" — the same rider shape every other display
    # setting here already uses.
    unchanged = await Mutation().assign_display(
        view=DisplayView.PROJECTOR, display_id="scr-1"
    )
    assert unchanged.replays is False

    back_on = await Mutation().assign_display(
        view=DisplayView.PROJECTOR, display_id="scr-1", replays=True
    )
    assert back_on.replays is True
    await stream.aclose()


# --------------------------------------------------------------------------- #
# `lastClipAt`                                                                #
# --------------------------------------------------------------------------- #


async def test_last_clip_at_is_null_until_a_clip_lands(db):
    stream = Subscription().display_assignment(
        _info(db), display_id="cam-1", race_id=1, role=DisplayRole.CAMERA
    )
    first = await _first(stream)

    assert first.last_clip_at is None
    await stream.aclose()


def test_record_clip_stamps_last_clip_at():
    registry.connect("cam-1", race_id=1, role=DisplayRole.CAMERA)

    display = registry.record_clip("cam-1")

    assert display is not None
    assert display.last_clip_at is not None


def test_record_clip_on_an_unseen_camera_is_a_no_op():
    assert registry.record_clip("ghost") is None
