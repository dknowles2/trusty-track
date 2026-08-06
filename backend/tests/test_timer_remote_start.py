"""Releasing the start gate from software (issue #111).

Some timers can drive a solenoid on the start gate, so one operator can run a
heat instead of two. The whole of the feature is a few bytes on the wire; what
is worth testing is everything guarding them, because this is the one thing in
the timer subsystem that *moves something physical*.

Two conditions, and they are separate claims:

- **The device has a command for it.** A profile field, like `abort`.
- **This track has the solenoid the command drives.** Nothing in any protocol
  reports that — the MicroWizard's gate release is a separately-sold accessory
  and `LG` is silently ignored without it — so it is the operator's setting,
  off until they say otherwise. DerbyNet reaches the same conclusion and gates
  its FastTrack remote start behind a command-line flag.
"""

from dataclasses import replace

from backend.db import models
from backend.services.timer.devices import FAKE, MICROWIZARD
from backend.services.timer.devices.derbynet import PDT
from backend.services.timer.manager import TimerManager
from backend.services.timer.state_machine import TimerState


def manager(profile=MICROWIZARD, *, installed=True) -> TimerManager:
    return TimerManager(track_id=1, device=profile, remote_start_installed=installed)


def sent(mgr: TimerManager) -> list[str]:
    return [e.data for e in mgr._serial_log if e.direction == "TX"]


async def armed(mgr: TimerManager) -> TimerManager:
    await mgr.prepare_heat(heat_id=1, kind=models.HeatKind.OFFICIAL, lane_mask=0b11)
    mgr._serial_log.clear()
    return mgr


# ---------------------------------------------------------------------------
# Whether the control is offered at all
# ---------------------------------------------------------------------------


async def test_a_device_with_the_command_on_a_track_with_the_gate_can():
    assert manager().can_remote_start() is True


async def test_a_track_without_the_gate_cannot():
    """The default, and the one that matters: a wrong False costs a button that
    is not offered, a wrong True costs a gate that opens unexpectedly."""
    assert manager(installed=False).can_remote_start() is False


async def test_a_device_without_the_command_cannot():
    assert manager(FAKE).can_remote_start() is False


async def test_the_answer_is_on_the_status_payload():
    """The client has no copy of the profiles by design, so it cannot work this
    out for itself."""
    assert manager().status().can_remote_start is True
    assert manager(installed=False).status().can_remote_start is False


async def test_changing_the_track_setting_publishes():
    """The control it governs is on the operator screen. A setting saved in
    another tab should make the button appear without a refresh."""
    mgr = manager(installed=False)
    published = []
    mgr_status = mgr.status

    async def capture(_channel, payload):
        published.append(payload)

    import backend.services.timer.manager as manager_module

    original = manager_module.pubsub.publish
    manager_module.pubsub.publish = capture
    try:
        await mgr.set_remote_start_installed(True)
        # Setting it to what it already is publishes nothing.
        await mgr.set_remote_start_installed(True)
    finally:
        manager_module.pubsub.publish = original

    assert len(published) == 1
    assert published[0].can_remote_start is True
    assert mgr_status().can_remote_start is True


# ---------------------------------------------------------------------------
# Sending it
# ---------------------------------------------------------------------------


async def test_an_armed_heat_releases_the_gate():
    mgr = await armed(manager())

    assert await mgr.release_start_gate() is None
    assert sent(mgr) == ["LG"]

    await mgr.stop()


async def test_a_staged_heat_releases_the_gate():
    """READY is the normal case on a device that can see its own gate: cars are
    behind a closed gate, waiting for it to open."""
    mgr = await armed(manager())
    mgr._state = TimerState.READY

    assert await mgr.release_start_gate() is None
    assert sent(mgr) == ["LG"]

    await mgr.stop()


async def test_the_profiles_command_is_the_one_sent():
    """Not a constant. The PDT says `S` where the MicroWizard says `LG`."""
    mgr = await armed(manager(PDT))

    assert await mgr.release_start_gate() is None
    assert sent(mgr) == ["S"]

    await mgr.stop()


# ---------------------------------------------------------------------------
# Refusing to
# ---------------------------------------------------------------------------


async def test_an_idle_timer_refuses():
    """Releasing a gate with no heat armed sends cars down a track nothing is
    timing, and the times are gone — there is no second run of a heat that was
    never armed."""
    mgr = manager()
    mgr._state = TimerState.IDLE

    reason = await mgr.release_start_gate()

    assert reason is not None and "No heat is armed" in reason
    assert sent(mgr) == []


async def test_a_running_timer_refuses():
    """The gate is already open."""
    mgr = await armed(manager())
    mgr._state = TimerState.RUNNING

    assert await mgr.release_start_gate() is not None
    assert sent(mgr) == []

    await mgr.stop()


async def test_a_track_without_the_gate_refuses_even_when_armed():
    """The command exists and the heat is armed; the hardware is the missing
    piece, and it is the one nothing can detect."""
    mgr = await armed(manager(installed=False))

    reason = await mgr.release_start_gate()

    assert reason is not None and "not set up" in reason
    assert sent(mgr) == []

    await mgr.stop()


async def test_a_device_without_the_command_refuses_by_name():
    """ "Your timer cannot do this" and "your track is not set up for it" are
    different problems with different fixes, so they are different messages."""
    silent = replace(MICROWIZARD, key="silent", remote_start=())
    mgr = await armed(manager(silent))

    reason = await mgr.release_start_gate()

    assert reason is not None and silent.name in reason
    assert sent(mgr) == []

    await mgr.stop()


# ---------------------------------------------------------------------------
# Through the API
# ---------------------------------------------------------------------------


def test_the_track_setting_round_trips(client):
    """Off by default, and settable — it is the only way the feature turns on."""
    created = client.post(
        "/graphql",
        json={
            "query": """
            mutation {
                createTrack(track: {name: "Gate Track", timerType: "FAKE"}) {
                    id
                    remoteStartInstalled
                }
            }
            """
        },
    ).json()["data"]["createTrack"]

    assert created["remoteStartInstalled"] is False

    updated = client.post(
        "/graphql",
        json={
            "query": """
            mutation($id: Int!) {
                updateTrack(id: $id, track: {
                    name: "Gate Track",
                    timerType: "FAKE",
                    remoteStartInstalled: true
                }) {
                    remoteStartInstalled
                }
            }
            """,
            "variables": {"id": created["id"]},
        },
    ).json()["data"]["updateTrack"]

    assert updated["remoteStartInstalled"] is True


def test_the_mutation_says_why_when_it_refuses(client):
    """A string rather than a bool: every refusal has a different operator
    response, and "false" in front of a queue of Cub Scouts is not one."""
    resp = client.post(
        "/graphql",
        json={
            "query": """
            mutation { releaseStartGate(trackId: 999999) }
            """
        },
    )

    assert resp.json()["data"]["releaseStartGate"] == (
        "No timer is configured for this track"
    )
