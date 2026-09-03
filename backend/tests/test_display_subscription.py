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
import contextlib

import pytest

import backend.api.schema as schema_mod
from backend.api.pubsub import _PubSub
from backend.api.schema import Mutation, Query, Subscription
from backend.db import crud, schemas
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


def _info(db, managers=None):
    class MockInfo:
        context = {"db": db, "timer_managers": managers or {}}

    return MockInfo()


async def _first(agen):
    return await asyncio.wait_for(agen.__anext__(), timeout=TIMEOUT)


@pytest.mark.asyncio
async def test_subscribing_registers_the_display(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)

    first = await _first(stream)

    assert first.display_id == "abc"
    assert [d.display_id for d in Query().displays(race_id=1)] == ["abc"]
    await stream.aclose()


@pytest.mark.asyncio
async def test_the_opening_payload_carries_the_default_view(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)

    first = await _first(stream)

    assert first.view is DisplayView.STANDINGS
    assert first.description
    await stream.aclose()


@pytest.mark.asyncio
async def test_an_assignment_reaches_a_connected_display(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    await Mutation().assign_display(view=DisplayView.PROJECTOR, display_id="abc")

    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert payload.view is DisplayView.PROJECTOR
    await stream.aclose()


@pytest.mark.asyncio
async def test_the_display_is_registered_before_its_opening_payload(db):
    """The window `test_subscription_snapshot_race.py` exists for.

    `pubsub.subscribe` registers the queue on entry, so an assignment made
    before that reaches nothing. Here the danger is narrower and worse: if
    registration happened *after* the first yield, an operator who assigned in
    that window would be told the display does not exist, and the screen would
    sit on the wrong view for the rest of the event.

    Asserting the mutation *finds* the display before the payload is drained is
    what pins the ordering.
    """
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    first = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)

    assigned = await Mutation().assign_display(
        view=DisplayView.TIMING, display_id="abc"
    )

    assert assigned is not None, "the display was not registered before it was told"
    await asyncio.wait_for(first, timeout=TIMEOUT)
    await stream.aclose()


@pytest.mark.asyncio
async def test_closing_the_socket_marks_the_display_quiet_but_keeps_it(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)

    await stream.aclose()

    listed = Query().displays(race_id=1)
    assert [d.display_id for d in listed] == ["abc"]
    assert listed[0].connected is False


@pytest.mark.asyncio
async def test_a_reconnecting_display_keeps_what_it_was_told(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)
    await Mutation().assign_display(view=DisplayView.CYCLE, display_id="abc")
    await Mutation().rename_display(display_id="abc", name="Gym north")
    await stream.aclose()

    again = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    payload = await _first(again)

    assert payload.view is DisplayView.CYCLE
    assert payload.name == "Gym north"
    await again.aclose()


@pytest.mark.asyncio
async def test_the_operator_list_updates_when_a_display_arrives(db):
    listing = Subscription().displays(race_id=1)
    assert await _first(listing) == []

    following = asyncio.create_task(listing.__anext__())
    await asyncio.sleep(0.05)
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
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
async def test_an_interval_below_a_second_is_refused(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)

    with pytest.raises(ValueError):
        await Mutation().assign_display(
            view=DisplayView.CYCLE, display_id="abc", cycle_seconds=0
        )
    await stream.aclose()


@pytest.mark.asyncio
async def test_forgetting_a_display_removes_it_from_the_list(db):
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)
    await stream.aclose()

    assert await Mutation().forget_display(display_id="abc") is True
    assert Query().displays(race_id=1) == []


# -- the Display theme, pushed live (#586) ---------------------------------


def _organization(db, display_theme="MATCH_APP"):
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name="Pack 1")
    )
    organization.display_theme = display_theme
    db.commit()
    db.refresh(organization)
    return organization


@pytest.mark.asyncio
async def test_the_opening_payload_carries_the_organizations_display_theme(db):
    _organization(db, display_theme="old-glory")

    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)

    first = await _first(stream)

    assert first.display_theme_setting == "old-glory"
    await stream.aclose()


@pytest.mark.asyncio
async def test_changing_the_theme_pushes_to_a_display_already_connected(db):
    """The whole point of #586: no reload, and no re-subscribing.

    `updateInitialConfig` is the settings-page mutation, and this is the leash
    every open display already holds — the same channel an ordinary
    assignment travels over, so a screen that never touches its own list still
    hears about a theme change made from across the room.
    """
    _organization(db, display_theme="MATCH_APP")

    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    opening = await _first(stream)
    assert opening.display_theme_setting == "MATCH_APP"

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)

    await Mutation().update_initial_config(
        _info(db),
        config=schema_mod.InitialConfigInput(
            organization_name="Pack 1", tracks=[], display_theme="newsprint"
        ),
    )

    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert payload.display_theme_setting == "newsprint"
    await stream.aclose()


@pytest.mark.asyncio
async def test_a_display_on_a_different_race_still_hears_the_theme_change(db):
    """The setting is install-wide, not race-scoped (#498) — every connected
    screen has to hear it, whichever race it happens to be pointed at."""
    _organization(db, display_theme="MATCH_APP")

    stream = Subscription().display_assignment(_info(db), display_id="xyz", race_id=2)
    await _first(stream)

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)

    await Mutation().update_initial_config(
        _info(db),
        config=schema_mod.InitialConfigInput(
            organization_name="Pack 1", tracks=[], display_theme="trail-colors"
        ),
    )

    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert payload.display_theme_setting == "trail-colors"
    await stream.aclose()


@pytest.mark.asyncio
async def test_a_theme_unchanged_by_the_save_does_not_nudge_a_connected_display(db):
    """A save that leaves `display_theme` alone must not wake every screen for
    nothing — the flood the registry's `all_ids` walk would otherwise cause on
    an ordinary System Settings save that touches unrelated fields."""
    _organization(db, display_theme="old-glory")

    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)

    await Mutation().update_initial_config(
        _info(db),
        config=schema_mod.InitialConfigInput(
            organization_name="Pack 1 Renamed", tracks=[]
        ),
    )

    assert not following.done()
    following.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await following
    await stream.aclose()
