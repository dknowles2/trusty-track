"""Choosing a timer model by hand (#143).

Before this, `TimerType` offered three transports and nothing said *which
timer*. Detection covered six of the seven profiles; the NewBold family answers
no identifying question, so it shipped and could not be reached at all — and a
hand-entered port used `DEFAULT_PROFILE`, which would have opened a NewBold's
1200 baud, 7 data bit, 2 stop bit port at 9600 8-N-1 and read noise.

`Track.timer_profile` is the model. `timer_type` stays the transport: the same
MicroWizard can be on either, and knowing the model does not tell you which.
"""

import asyncio

import pytest

from backend.api.schema import _device_for, _start_backend_direct
from backend.db import crud, models, schemas
from backend.services.timer.devices import (
    ALL_PROFILES,
    DEFAULT_PROFILE,
    FAKE,
    by_key,
)
from backend.services.timer.devices.derbynet import ADAPTED_FROM_DERBYNET


def _track(db, **fields):
    return crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, **fields)
    )


def _newbold():
    """The profile the whole issue is about: shipped, and unreachable."""
    for profile in ADAPTED_FROM_DERBYNET:
        if not (profile.probe and profile.identification):
            return profile
    raise AssertionError("every DerbyNet profile is probeable; #143 is stale")


# --------------------------------------------------------------------------- #
# Which device a track runs on                                                 #
# --------------------------------------------------------------------------- #


def test_no_choice_still_means_detect_it(db):
    """The behaviour every existing track has, and the reason the column is
    nullable rather than defaulted."""
    track = _track(db, timer_type="AUTO_DETECT_BACKEND")

    assert track.timer_profile is None
    assert _device_for(track) is DEFAULT_PROFILE


def test_a_chosen_model_is_the_device(db):
    chosen = _newbold()
    track = _track(db, timer_type="AUTO_DETECT_BACKEND", timer_profile=chosen.key)

    assert _device_for(track) is chosen


def test_a_chosen_model_brings_its_own_framing(db):
    """The point of the exercise. `connect_direct` opens the port with the
    device's framing, so choosing the model is what makes 1200 7-2 reachable —
    `DEFAULT_PROFILE` would have opened it at 9600 8-N-1 and read noise."""
    chosen = _newbold()
    track = _track(db, timer_type="AUTO_DETECT_BACKEND", timer_profile=chosen.key)

    device = _device_for(track)
    assert (device.baud_rate, device.data_bits, device.stop_bits) != (
        DEFAULT_PROFILE.baud_rate,
        DEFAULT_PROFILE.data_bits,
        DEFAULT_PROFILE.stop_bits,
    )


def test_fake_wins_over_any_chosen_model(db):
    """`timer_type` is the transport, and FAKE has no port. A model left behind
    from a previous setting must not put a serial profile on it."""
    track = _track(db, timer_type="FAKE", timer_profile=_newbold().key)

    assert _device_for(track) is FAKE


def test_the_fake_timer_cannot_be_chosen_as_a_model(db):
    """It is reachable through `timer_type`, and offering it in both places
    would let a track ask for a fake timer over a real serial port."""
    track = _track(db, timer_type="AUTO_DETECT_BACKEND", timer_profile=FAKE.key)

    assert _device_for(track) is DEFAULT_PROFILE


def test_a_key_that_names_nothing_falls_back_to_detecting(db):
    """A stale setting should leave the track detecting, not leave it dead."""
    track = _track(db, timer_type="AUTO_DETECT_BACKEND", timer_profile="no-such-timer")

    assert _device_for(track) is DEFAULT_PROFILE


# --------------------------------------------------------------------------- #
# What the port search does with a chosen model                                #
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_a_chosen_model_narrows_the_port_search():
    """An operator who named their timer is asking *which port*, not *which
    timer* — and a probe writes to every port it tries, so walking six other
    models' probe commands over their hardware is not a free extra."""
    asked: list = []

    class _Manager:
        async def autodetect(self, profiles=None):
            asked.append(profiles)

        async def connect_direct(self, _port):  # pragma: no cover - not this path
            raise AssertionError("no port was configured")

    chosen = ALL_PROFILES[1]
    _start_backend_direct(_Manager(), None, chosen)
    # `_start_backend_direct` schedules the work; let the loop run it.
    await asyncio.sleep(0)

    assert asked == [[chosen]]


@pytest.mark.anyio
async def test_no_chosen_model_walks_everything():
    asked: list = []

    class _Manager:
        async def autodetect(self, profiles=None):
            asked.append(profiles)

        async def connect_direct(self, _port):  # pragma: no cover - not this path
            raise AssertionError("no port was configured")

    _start_backend_direct(_Manager(), None, None)
    await asyncio.sleep(0)

    assert asked == [None]


# --------------------------------------------------------------------------- #
# The catalogue the picker is built from                                       #
# --------------------------------------------------------------------------- #


def test_the_catalogue_offers_every_real_profile(client):
    response = client.post(
        "/graphql",
        json={
            "query": """
            query { timerModels { key name provenance detectable baudRate } }
            """
        },
    )
    models_out = response.json()["data"]["timerModels"]

    assert [m["key"] for m in models_out] == [p.key for p in ALL_PROFILES]
    # Every one says where it came from, because "we have a profile for your
    # timer" and "your timer is known to work" are different claims.
    assert all(m["provenance"] for m in models_out)


def test_the_catalogue_says_which_models_cannot_be_found(client):
    """The flag that justifies the picker existing at all."""
    response = client.post(
        "/graphql",
        json={"query": "query { timerModels { key detectable } }"},
    )
    detectable = {
        m["key"]: m["detectable"] for m in response.json()["data"]["timerModels"]
    }

    assert detectable[_newbold().key] is False
    assert any(detectable.values()), "nothing is detectable; the prober is broken"


def test_the_fake_timer_is_not_in_the_catalogue(client):
    response = client.post(
        "/graphql",
        json={"query": "query { timerModels { key } }"},
    )
    keys = [m["key"] for m in response.json()["data"]["timerModels"]]

    assert FAKE.key not in keys
    assert by_key(FAKE.key) is FAKE, "still reachable by key, just not offered"


# --------------------------------------------------------------------------- #
# Round trip                                                                   #
# --------------------------------------------------------------------------- #


def test_a_chosen_model_survives_the_api(client, db):
    chosen = _newbold()
    created = client.post(
        "/graphql",
        json={
            "query": """
            mutation Make($track: TrackInput!) {
                createTrack(track: $track) { id timerProfile }
            }
            """,
            "variables": {
                "track": {
                    "name": "Picked",
                    "laneCount": 4,
                    "timerType": "AUTO_DETECT_BACKEND",
                    "timerProfile": chosen.key,
                }
            },
        },
    ).json()
    assert "errors" not in created, created

    track_id = created["data"]["createTrack"]["id"]
    assert created["data"]["createTrack"]["timerProfile"] == chosen.key

    stored = db.query(models.Track).filter(models.Track.id == track_id).one()
    assert stored.timer_profile == chosen.key
    assert _device_for(stored) is chosen
