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
from backend.api.pubsub import MAX_QUEUE_SIZE, _PubSub
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


@pytest.mark.asyncio
async def test_forgetting_a_display_that_is_still_connected_does_not_strand_it(db):
    """#758: a screen the operator forgets while it is still open must not
    freeze on its last view with nothing server-side able to reach it again.

    Before the fix, `forget_display` popped the row with no connectivity
    check and never nudged the display's own subscription — so a still-open
    `displayAssignment` stream just hung forever with no display left in the
    registry for any later mutation to publish to. The fix re-registers the
    display, live, as a fresh unassigned screen — exactly the state it would
    be in on a genuine first connect — so the operator's list, and the
    screen's own subscription, both recover.
    """
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)
    await Mutation().assign_display(view=DisplayView.PROJECTOR, display_id="abc")

    # Drain the assignment's own payload before listening for the forget, or
    # the two events race and the "following" task below just resolves to
    # this one instead.
    projected = await asyncio.wait_for(stream.__anext__(), timeout=TIMEOUT)
    assert projected.view is DisplayView.PROJECTOR

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    assert await Mutation().forget_display(display_id="abc") is True

    # The still-open subscription hears about it and recovers rather than
    # hanging forever.
    payload = await asyncio.wait_for(following, timeout=TIMEOUT)
    assert payload.display_id == "abc"
    assert payload.assigned is False, "a forgotten screen must fall back to its URL"

    # And it is back on the operator's list, not vanished.
    assert [d.display_id for d in Query().displays(race_id=1)] == ["abc"]

    # A later assignment reaches the screen again — nothing is permanently
    # unreachable.
    following2 = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    await Mutation().assign_display(view=DisplayView.TIMING, display_id="abc")
    payload2 = await asyncio.wait_for(following2, timeout=TIMEOUT)
    assert payload2.view is DisplayView.TIMING

    await stream.aclose()


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


# --------------------------------------------------------------------------- #
# #881 — a backed-up queue must not collapse two ceremony steps into one      #
# --------------------------------------------------------------------------- #
#
# `display_assignment`'s payload is always `None` — every event on the
# channel is a "go re-read the registry" nudge, not data of its own — but
# what it nudges the subscriber to re-read is not a snapshot in the sense
# #776's bound assumed. `Display.slide_delta` is overwritten on every
# `advanceDisplay` call, not accumulated, and `AwardCeremony.tsx` applies it
# exactly once per distinct `slideSeq` it observes. So the channel's actual
# unit of information is "one more nudge happened", and a bound that drops
# an older nudge in favour of a newer one silently discards an operator's
# "Next" click the same way it would discard a stale snapshot — except there
# is no newer snapshot standing in for it, because the one that got dropped
# was never redundant to begin with.


@pytest.mark.asyncio
async def test_the_display_assignment_channel_does_not_bound_its_queue(db):
    """Wiring check: this is the one subscription #881 names, and it must be
    the one opted out of #776's drop-oldest bound."""
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)

    queue = displays_service_queue(schema_mod.pubsub, "abc")
    assert queue.maxsize == 0
    await stream.aclose()


@pytest.mark.asyncio
async def test_two_advance_display_steps_are_not_collapsed_by_a_backed_up_queue(db):
    """Two `advanceDisplay` calls landing while a display's queue is already
    backed up — a projector on flaky wifi, the case the ping watchdog is
    meant to make rare but not impossible — must both still be waiting to be
    delivered once the connection catches up. On `main`, #776's bound caps
    the queue at `MAX_QUEUE_SIZE` and drops the oldest entry once it is full,
    so two more real steps arriving on top of an already-full backlog cannot
    grow the queue at all: two markers are silently destroyed to make room,
    and whichever step they represented never reaches the screen."""
    stream = Subscription().display_assignment(_info(db), display_id="abc", race_id=1)
    await _first(stream)  # drains the opening payload

    queue = displays_service_queue(schema_mod.pubsub, "abc")

    # Simulate a connection that has already fallen behind: MAX_QUEUE_SIZE
    # unrelated nudges (a rename, a theme change, a forget-and-reconnect)
    # sitting unread.
    for _ in range(MAX_QUEUE_SIZE):
        await schema_mod.pubsub.publish("display_assignment:abc", None)
    assert queue.qsize() == MAX_QUEUE_SIZE

    # Two real operator "Next" clicks land on top of that backlog.
    d1 = await Mutation().advance_display(display_id="abc", delta=1)
    d2 = await Mutation().advance_display(display_id="abc", delta=1)
    assert d1.slide_seq == 1
    assert d2.slide_seq == 2

    # The queue must grow to hold every nudge a genuinely-stalled connection
    # is owed, not stay capped at MAX_QUEUE_SIZE with two of them thrown away.
    assert queue.qsize() == MAX_QUEUE_SIZE + 2
    await stream.aclose()


def displays_service_queue(bus, display_id: str):
    return bus._subscribers[f"display_assignment:{display_id}"][0]
