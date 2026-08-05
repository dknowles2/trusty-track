"""`heatSession` — the server assembling the live view (#7, step one).

`test_domain_heat_session.py` holds the rule. This holds the wiring: that the
heat and the timer both reach it, that the timer used is the one for the track
asked about, and that a heat id naming nothing is answered rather than raised.

The timer here is a real `TimerManager` over `the fake timer profile` driven by
injected events, not a mock. Pending results only exist as a side effect of the
manager's state machine, and a stubbed status would prove the resolver reads a
stub.
"""

import json

import pytest
from fastapi.testclient import TestClient

from backend.api.main import TIMER_MANAGERS, app
from backend.db import crud, models, schemas
from backend.services.timer.devices import FAKE
from backend.services.timer.devices.base import LaneResult, RaceStarted
from backend.services.timer.manager import TimerManager

client = TestClient(app)

QUERY = """
query HeatSessionTest($trackId: Int!, $heatId: Int) {
    heatSession(trackId: $trackId, heatId: $heatId) {
        trackId
        heatId
        phase
        timerState
        lanes { lane racerId placeholderSlot time place skipped pending }
    }
}
"""


def _query(track_id, heat_id=None):
    resp = client.post(
        "/graphql",
        json={
            "query": QUERY,
            "variables": {"trackId": track_id, "heatId": heat_id},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    return body["data"]["heatSession"]


@pytest.fixture(autouse=True)
def registered_manager():
    """Own the timer registry for the duration of each test in this module.

    `TIMER_MANAGERS` is a process-wide dict populated at startup and left
    populated by other tests, and track ids restart at 1 on every in-memory
    database — so a test asserting *no* timer would otherwise pick up whichever
    manager a previous test happened to leave on track 1. Emptying it makes "no
    timer" the default and `register()` the opt-in; the snapshot goes back
    afterwards so nothing outside this module notices.
    """
    saved = dict(TIMER_MANAGERS)
    TIMER_MANAGERS.clear()

    def register(track_id: int) -> TimerManager:
        manager = TimerManager(track_id=track_id, device=FAKE)
        TIMER_MANAGERS[track_id] = manager
        return manager

    yield register

    TIMER_MANAGERS.clear()
    TIMER_MANAGERS.update(saved)


def _race(db, lane_count=4):
    group = crud.create_group(db, schemas.GroupCreate(name="Session Group"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(
            name="Session Track", lane_count=lane_count, timer_type="FAKE"
        ),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Session Race",
            group_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    return race, track


def _racers(db, race, *names):
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(first_name=name, last_name="R", race_id=race.id),
        )
        for name in names
    ]


def _heat(db, race, lanes, *, round_obj=None):
    round_obj = round_obj or crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(lanes),
    )
    db.add(heat)
    db.commit()
    return heat


# --------------------------------------------------------------------------- #
# The heat alone                                                               #
# --------------------------------------------------------------------------- #


def test_a_scheduled_heat_with_no_timer_is_waiting(db):
    """No manager registered for the track — the heat is still answerable."""
    race, track = _race(db)
    ava, ben = _racers(db, race, "Ava", "Ben")
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": ava.id, "time": None, "place": None},
            {"lane": 2, "racer_id": ben.id, "time": None, "place": None},
        ],
    )

    session = _query(track.id, heat.id)

    assert session["phase"] == "WAITING"
    assert session["timerState"] == "DISCONNECTED"
    assert session["lanes"] == [
        {
            "lane": 1,
            "racerId": ava.id,
            "placeholderSlot": None,
            "time": None,
            "place": None,
            "skipped": False,
            "pending": False,
        },
        {
            "lane": 2,
            "racerId": ben.id,
            "placeholderSlot": None,
            "time": None,
            "place": None,
            "skipped": False,
            "pending": False,
        },
    ]


def test_a_recorded_heat_reports_its_saved_results(db):
    race, track = _race(db)
    ava, ben = _racers(db, race, "Ava", "Ben")
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": ava.id, "time": 3.412, "place": 2},
            {"lane": 2, "racer_id": ben.id, "time": 3.310, "place": 1},
        ],
    )

    session = _query(track.id, heat.id)

    assert session["phase"] == "RECORDED"
    assert [(lane["time"], lane["place"]) for lane in session["lanes"]] == [
        (3.412, 2),
        (3.310, 1),
    ]
    assert not any(lane["pending"] for lane in session["lanes"])


def test_a_championship_heat_awaiting_its_field_is_not_ready(db):
    """The negative-id placeholder encoding does not escape (#5)."""
    race, track = _race(db)
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": -1, "time": None, "place": None},
            {"lane": 2, "racer_id": -2, "time": None, "place": None},
        ],
    )

    session = _query(track.id, heat.id)

    assert session["phase"] == "NOT_READY"
    assert [lane["racerId"] for lane in session["lanes"]] == [None, None]
    assert [lane["placeholderSlot"] for lane in session["lanes"]] == [1, 2]


def test_no_heat_selected_and_no_timer(db):
    _, track = _race(db)

    session = _query(track.id)

    assert session == {
        "trackId": track.id,
        "heatId": None,
        "phase": "NO_HEAT",
        "timerState": "DISCONNECTED",
        "lanes": [],
    }


def test_a_heat_id_naming_nothing_is_no_heat(db):
    """Not an error. The operator can delete a round while its heat is armed,
    and the screen asking about it should get an answer, not a 500."""
    _, track = _race(db)

    session = _query(track.id, 999_999)

    assert session["phase"] == "NO_HEAT"
    assert session["heatId"] is None
    assert session["lanes"] == []


# --------------------------------------------------------------------------- #
# The heat merged with the timer                                               #
# --------------------------------------------------------------------------- #


@pytest.mark.anyio
async def test_lane_times_appear_before_they_are_saved(db, registered_manager):
    """The reason this field exists. Two of four lanes have finished; the times
    are in the manager's memory and nowhere else."""
    race, track = _race(db)
    racers = _racers(db, race, "Ava", "Ben", "Cal", "Dee")
    heat = _heat(
        db,
        race,
        [
            {"lane": i + 1, "racer_id": r.id, "time": None, "place": None}
            for i, r in enumerate(racers)
        ],
    )

    manager = registered_manager(track.id)
    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b1111
    )
    await manager.inject_event(RaceStarted())
    await manager.inject_event(LaneResult(lane=1, time_seconds=3.101, place=1))
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.202, place=2))

    session = _query(track.id, heat.id)

    assert session["phase"] == "RUNNING"
    # Still RUNNING, not RESULTS_OVERDUE — the manager only goes overdue on a
    # timeout, not on having some of the lanes.
    assert session["timerState"] == "RUNNING"
    assert [(lane["time"], lane["pending"]) for lane in session["lanes"]] == [
        (3.101, True),
        (3.202, True),
        (None, False),
        (None, False),
    ]
    # Nothing has been persisted yet — that is the whole point.
    db.expire_all()
    stored = json.loads(
        db.query(models.Heat).filter(models.Heat.id == heat.id).first().lane_results
    )
    assert all(lane["time"] is None for lane in stored)


@pytest.mark.anyio
async def test_the_armed_heat_is_used_when_none_is_named(db, registered_manager):
    """The direction of #7: the server knows which heat the track is running."""
    race, track = _race(db, lane_count=2)
    ava, ben = _racers(db, race, "Ava", "Ben")
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": ava.id, "time": None, "place": None},
            {"lane": 2, "racer_id": ben.id, "time": None, "place": None},
        ],
    )

    manager = registered_manager(track.id)
    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )

    session = _query(track.id)

    assert session["heatId"] == heat.id
    assert session["phase"] == "WAITING"
    assert session["timerState"] == "ARMED"


@pytest.mark.anyio
async def test_the_timer_names_the_racer_in_a_lane(db, registered_manager):
    """A free race arms the timer with its own lane mapping, so the schedule is
    not always the answer."""
    race, track = _race(db, lane_count=2)
    ava, ben = _racers(db, race, "Ava", "Ben")
    free = crud.create_free_race_heat(
        db,
        race.id,
        [{"lane": 1, "racer_id": ava.id}, {"lane": 2, "racer_id": None}],
    )

    manager = registered_manager(track.id)
    await manager.prepare_heat(
        heat_id=free.id,
        kind=models.HeatKind.FREE,
        lane_mask=0b11,
        racer_by_lane={1: ava.id, 2: ben.id},
    )
    await manager.inject_event(RaceStarted())
    await manager.inject_event(LaneResult(lane=2, time_seconds=3.5, place=1))

    session = _query(track.id, free.id)

    lane_two = next(lane for lane in session["lanes"] if lane["lane"] == 2)
    assert lane_two["racerId"] == ben.id, (
        "the schedule left lane 2 empty; the timer knows who ran in it"
    )
    assert lane_two["pending"] is True


@pytest.mark.anyio
async def test_a_recorded_heat_ignores_a_timer_that_has_not_caught_up(
    db, registered_manager
):
    """The expensive case to get wrong: saved results must not be contradicted
    on screen by a report belonging to a superseded run."""
    race, track = _race(db, lane_count=2)
    ava, ben = _racers(db, race, "Ava", "Ben")
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": ava.id, "time": 3.400, "place": 1},
            {"lane": 2, "racer_id": ben.id, "time": 3.500, "place": 2},
        ],
    )

    manager = registered_manager(track.id)
    await manager.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )
    await manager.inject_event(RaceStarted())
    await manager.inject_event(LaneResult(lane=1, time_seconds=9.999, place=2))

    session = _query(track.id, heat.id)

    assert session["phase"] == "RECORDED"
    assert [lane["time"] for lane in session["lanes"]] == [3.400, 3.500]


@pytest.mark.anyio
async def test_another_track_s_timer_is_not_consulted(db, registered_manager):
    """One manager per track, and this is the field that could quietly mix them
    — the heat is found by id alone, so nothing else would notice."""
    race, track = _race(db, lane_count=2)
    ava, ben = _racers(db, race, "Ava", "Ben")
    heat = _heat(
        db,
        race,
        [
            {"lane": 1, "racer_id": ava.id, "time": None, "place": None},
            {"lane": 2, "racer_id": ben.id, "time": None, "place": None},
        ],
    )

    other = registered_manager(track.id + 500)
    await other.prepare_heat(
        heat_id=heat.id, kind=models.HeatKind.OFFICIAL, lane_mask=0b11
    )
    await other.inject_event(RaceStarted())
    await other.inject_event(LaneResult(lane=1, time_seconds=3.1, place=1))

    session = _query(track.id, heat.id)

    assert session["timerState"] == "DISCONNECTED"
    assert not any(lane["pending"] for lane in session["lanes"])
