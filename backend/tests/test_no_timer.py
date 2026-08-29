"""A track configured with no timer at all (#490).

Three things this pins, each a way #490 could regress:

* ``_device_for`` and the manager wiring never probe or open a port for a
  track configured this way — ``services/timer/devices/no_timer.py`` holds
  the device, and ``NO_TIMER`` is deliberately absent from ``ALL_PROFILES``
  and ``by_key``, the same as ``FAKE``.
* ``prepareHeat`` and ``startTimerTest`` both refuse to arm it — there is
  nothing to arm, and hand entry through the Override/Edit modal is the only
  way a result is ever going to exist.
* ``heatSession`` reports ``RECORDED`` for a hand-placed result with no time
  at all, which is `test_domain_heat_session.py`'s rule (extended for #490)
  exercised through the whole stack rather than as a pure function.
"""

import pytest
from fastapi.testclient import TestClient

from backend.api.main import TIMER_MANAGERS, app
from backend.api.schema import _device_for
from backend.db import crud, models, schemas
from backend.services.timer.devices import ALL_PROFILES, FAKE, NO_TIMER, by_key
from backend.services.timer.manager import TimerManager, initialize_timer_managers
from backend.services.timer.state_machine import TimerState
from backend.tests.helpers import record_heat_result

client = TestClient(app)

HEAT_SESSION = """
query HeatSessionTest($trackId: Int!, $heatId: Int) {
    heatSession(trackId: $trackId, heatId: $heatId) {
        trackId
        heatId
        phase
        timerState
        lanes { lane racerId time place skipped }
    }
}
"""

PREPARE_HEAT = """
    mutation($heatId: Int!) { prepareHeat(heatId: $heatId) }
"""

START_TIMER_TEST = """
    mutation($trackId: Int!) { startTimerTest(trackId: $trackId) }
"""


@pytest.fixture(autouse=True)
def registered_manager():
    """Own `TIMER_MANAGERS` for the module — it is a process-wide dict."""
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()
    yield
    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _gql(query, variables):
    resp = client.post("/graphql", json={"query": query, "variables": variables})
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    return body["data"]


def _no_timer_track(db):
    return crud.create_track(
        db,
        schemas.TrackCreate(name="No Timer Track", lane_count=2, timer_type="NONE"),
    )


def _race(db, track):
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name="No Timer Pack")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="No Timer Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )


def _heat_with_two_racers(db, race):
    """A heat, and the two racers assigned to it (`Heat` has no `.lanes`
    relationship of its own — lanes live in `heat_lanes`, read through
    `crud`)."""
    from backend.tests.helpers import as_lanes

    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
    db.add(heat)
    db.flush()
    a = crud.create_racer(
        db, schemas.RacerCreate(first_name="A", last_name="R", race_id=race.id)
    )
    b = crud.create_racer(
        db, schemas.RacerCreate(first_name="B", last_name="R", race_id=race.id)
    )
    crud.set_heat_lanes(
        heat,
        as_lanes(
            [
                {"lane": 1, "racer_id": a.id, "time": None, "place": None},
                {"lane": 2, "racer_id": b.id, "time": None, "place": None},
            ]
        ),
    )
    db.commit()
    return heat, a, b


# --------------------------------------------------------------------------- #
# The device, and never probing for one                                       #
# --------------------------------------------------------------------------- #


def test_device_for_a_no_timer_track_is_no_timer(db):
    track = _no_timer_track(db)
    assert _device_for(track) is NO_TIMER


def test_no_timer_has_no_port_to_open():
    """`requires_serial=False` is what keeps `TimerManager` out of
    `DISCONNECTED` — there is no port to open, the same reason `FAKE` sets it."""
    assert NO_TIMER.requires_serial is False


def test_no_timer_is_absent_from_the_probeable_set():
    """The same exclusion as `FAKE`: chosen by `timer_type`, not offered as a
    model to pick or a candidate a prober would try."""
    assert NO_TIMER not in ALL_PROFILES
    assert by_key("none") is None


async def test_initializing_managers_never_probes_a_no_timer_track(
    db, timer_session_factory, monkeypatch
):
    """The manager for a `NONE` track comes up straight into IDLE, holding
    `NO_TIMER`, and nothing ever asks a port prober about it."""
    track = _no_timer_track(db)

    def refuse(*args, **kwargs):  # noqa: ARG001
        raise AssertionError("a no-timer track must never be probed")

    monkeypatch.setattr(TimerManager, "autodetect", refuse)
    monkeypatch.setattr(TimerManager, "connect_direct", refuse)

    registry: dict[int, TimerManager] = {}
    await initialize_timer_managers(registry, session_factory=timer_session_factory)

    mgr = registry[track.id]
    assert mgr._device is NO_TIMER
    assert mgr._state is TimerState.IDLE


async def test_a_hand_configured_serial_port_is_ignored_for_no_timer(
    db, timer_session_factory, monkeypatch
):
    """A stale `serial_port` left over from switching a track away from a real
    transport must not make a no-timer track try to open it."""
    track = _no_timer_track(db)
    track.serial_port = "/dev/ttyUSB0"
    db.commit()

    def refuse(*args, **kwargs):  # noqa: ARG001
        raise AssertionError("a no-timer track must never open a port")

    monkeypatch.setattr(TimerManager, "connect_direct", refuse)
    monkeypatch.setattr(TimerManager, "autodetect", refuse)

    registry: dict[int, TimerManager] = {}
    await initialize_timer_managers(registry, session_factory=timer_session_factory)

    assert registry[track.id]._state is TimerState.IDLE


def test_switching_a_track_to_no_timer_drops_the_real_device(db):
    """`_device_for` used at update time, not only at startup — the same
    function every manager-building call site shares (#48)."""
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name="Was Real", lane_count=2, timer_type="AUTO_DETECT_BACKEND"
        ),
    )
    assert _device_for(track) is not NO_TIMER

    track = crud.update_track(
        db,
        track,
        schemas.TrackBase(name="Was Real", lane_count=2, timer_type="NONE"),
    )
    assert _device_for(track) is NO_TIMER


# --------------------------------------------------------------------------- #
# Arming is refused                                                            #
# --------------------------------------------------------------------------- #


def test_prepare_heat_is_refused_for_a_no_timer_track(db):
    track = _no_timer_track(db)
    race = _race(db, track)
    heat, *_ = _heat_with_two_racers(db, race)

    mgr = TimerManager(track_id=track.id, device=NO_TIMER)
    TIMER_MANAGERS[track.id] = mgr

    result = _gql(PREPARE_HEAT, {"heatId": heat.id})

    assert result["prepareHeat"] is False
    assert mgr._state is TimerState.IDLE
    assert mgr._active_heat_id is None


def test_start_timer_test_is_refused_for_a_no_timer_track(db):
    """A bench test exercises the device's own commands (#235) — there is
    none here."""
    track = _no_timer_track(db)
    mgr = TimerManager(track_id=track.id, device=NO_TIMER)
    TIMER_MANAGERS[track.id] = mgr

    result = _gql(START_TIMER_TEST, {"trackId": track.id})

    assert result["startTimerTest"] is False
    assert mgr._state is TimerState.IDLE


def test_a_real_timer_track_is_unaffected(db):
    """The guard is scoped to `NONE`, not to "arming failed for some other
    reason" — an ordinary fake-timer heat still arms."""
    track = crud.create_track(
        db, schemas.TrackCreate(name="Fake Track", lane_count=2, timer_type="FAKE")
    )
    race = _race(db, track)
    heat, *_ = _heat_with_two_racers(db, race)
    mgr = TimerManager(track_id=track.id, device=FAKE)
    TIMER_MANAGERS[track.id] = mgr

    result = _gql(PREPARE_HEAT, {"heatId": heat.id})

    assert result["prepareHeat"] is True
    assert mgr._state is TimerState.ARMED


# --------------------------------------------------------------------------- #
# heatSession phase for a hand-placed result                                  #
# --------------------------------------------------------------------------- #


def test_heat_session_is_waiting_before_anything_is_entered(db):
    track = _no_timer_track(db)
    race = _race(db, track)
    heat, *_ = _heat_with_two_racers(db, race)
    TIMER_MANAGERS[track.id] = TimerManager(track_id=track.id, device=NO_TIMER)

    data = _gql(HEAT_SESSION, {"trackId": track.id, "heatId": heat.id})

    assert data["heatSession"]["phase"] == "WAITING"
    # Never RUNNING: nothing ever arms a no-timer track, so the device has no
    # way to report a race under way.
    assert data["heatSession"]["timerState"] == "IDLE"


def test_heat_session_is_recorded_from_a_hand_typed_place_alone(db):
    """The whole point of #490. A `POINTS` race entered by hand through the
    Override/Edit modal never produces a time — `updateHeatResult` is sent a
    place and nothing else, exactly what `shouldDerivePlaces` on the frontend
    leaves untouched for a `POINTS` race — and the heat still has to read as
    finished, or the screen never offers Edit and the round can never be
    told it is complete."""
    track = _no_timer_track(db)
    race = _race(db, track)
    heat, racer_a, racer_b = _heat_with_two_racers(db, race)
    TIMER_MANAGERS[track.id] = TimerManager(track_id=track.id, device=NO_TIMER)

    record_heat_result(
        client,
        heat.id,
        [
            {"lane": 1, "racer_id": racer_a.id, "place": 1},
            {"lane": 2, "racer_id": racer_b.id, "place": 2},
        ],
    )

    data = _gql(HEAT_SESSION, {"trackId": track.id, "heatId": heat.id})

    assert data["heatSession"]["phase"] == "RECORDED"
    lanes_by_number = {lane["lane"]: lane for lane in data["heatSession"]["lanes"]}
    assert lanes_by_number[1]["place"] == 1
    assert lanes_by_number[1]["time"] is None
