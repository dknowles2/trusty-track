"""`raceStateChanged` carries what changed — issue #12.

The event used to be a bare "something happened" poke carrying only a race id,
so every subscriber answered it by refetching its entire page query. Measured
before this change: one recorded heat result cost 48 SQL queries across
subscribers, and a full 24-heat round cost about 1,150 — the same whether the
change was a heat result or someone fixing a typo in a racer's name.

The payloads are typed as the real `Heat` and `Racer` types deliberately, so a
normalized client cache can merge an event into the entity a query already put
there.
"""

import asyncio
import json

import pytest

from backend.api import schema as schema_module
from backend.api.pubsub import pubsub
from backend.api.schema import RaceChangeKind, schema
from backend.db import crud, models, schemas
from backend.tests.helpers import as_lanes, record_heat_result


def _seed(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Event Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Event Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Event Race", group_id=group.id, track_id=track.id),
    )
    return race


async def _capture(race_id, action, expected=1):
    """Run `action` and collect the events it publishes."""
    received = []
    ready = asyncio.Event()

    async def listen():
        async with pubsub.subscribe(f"race_state:{race_id}") as stream:
            ready.set()
            async for event in stream:
                received.append(event)
                if len(received) >= expected:
                    return

    task = asyncio.create_task(listen())
    await ready.wait()
    await action()
    try:
        await asyncio.wait_for(task, timeout=2)
    except asyncio.TimeoutError:  # pragma: no cover - only on failure
        task.cancel()
    return received


@pytest.mark.anyio
async def test_a_heat_result_carries_the_heat(db):
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ann", last_name="A", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps([{"lane": 1, "racer_id": racer.id, "time": None}]),
    )
    db.add(heat)
    db.commit()

    results = as_lanes([{"lane": 1, "racer_id": racer.id, "time": 3.25, "place": 1}])

    async def act():
        crud.record_heat_result(db, heat.id, results)
        await schema_module._publish_race_state(
            race.id,
            kind=RaceChangeKind.HEAT_RESULT,
            heat=db.query(models.Heat).get(heat.id),
            round_id=round_obj.id,
        )

    events = await _capture(race.id, act)
    assert len(events) == 1
    event = events[0]
    assert event.kind is RaceChangeKind.HEAT_RESULT
    assert event.round_id == round_obj.id
    assert event.racer is None
    assert event.heat is not None
    assert event.heat.id == heat.id
    assert json.loads(event.heat.lane_results)[0]["time"] == 3.25


@pytest.mark.anyio
async def test_a_racer_change_carries_the_racer(db):
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Bob", last_name="B", race_id=race.id)
    )

    async def act():
        await schema_module._publish_race_state(
            race.id, kind=RaceChangeKind.RACER, racer=racer
        )

    events = await _capture(race.id, act)
    assert events[0].kind is RaceChangeKind.RACER
    assert events[0].racer.id == racer.id
    assert events[0].racer.first_name == "Bob"
    assert events[0].heat is None


@pytest.mark.anyio
async def test_the_payload_survives_the_session_closing(db):
    """The point of snapshotting.

    Events are published from a mutation whose session is gone before any
    subscriber renders the payload. A live ORM object would raise
    DetachedInstanceError on the first attribute read.
    """
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Cara", last_name="C", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id, round_id=round_obj.id, heat_number=1, lane_results="[]"
    )
    db.add(heat)
    db.commit()

    async def act():
        await schema_module._publish_race_state(
            race.id,
            kind=RaceChangeKind.HEAT_RESULT,
            heat=db.query(models.Heat).get(heat.id),
            racer=racer,
        )

    events = await _capture(race.id, act)

    # Simulate the request ending: evict everything from the session.
    db.expunge_all()
    db.close()

    event = events[0]
    assert event.heat.id == heat.id
    assert event.heat.heat_number == 1
    assert event.heat.round.round_number == 1, "round snapshot must be captured too"
    assert event.racer.first_name == "Cara"


@pytest.mark.anyio
async def test_a_heat_payload_carries_its_lanes(db):
    """The structured lanes have to travel with the event (#5).

    The client cache merges this payload into the heat it already holds. A
    payload that omitted `lanes` would leave the previous ones in place, and the
    screen would show a new result against a stale schedule — which is exactly
    the failure the payloads were introduced to avoid.
    """
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Dee", last_name="D", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [{"lane": 1, "racer_id": racer.id}, {"lane": 2, "racer_id": -1}]
        ),
    )
    db.add(heat)
    db.commit()

    results = as_lanes(
        [
            {"lane": 1, "racer_id": racer.id, "time": 3.25, "place": 1},
            {"lane": 2, "racer_id": -1},
        ]
    )

    async def act():
        crud.record_heat_result(db, heat.id, results)
        await schema_module._publish_race_state(
            race.id,
            kind=RaceChangeKind.HEAT_RESULT,
            heat=db.query(models.Heat).get(heat.id),
        )

    events = await _capture(race.id, act)
    racer_id = racer.id

    # As above: the session is gone before a subscriber renders this.
    db.expunge_all()
    db.close()

    # What `Heat.lanes` calls. `info=None` proves it needs no session.
    snapshot = events[0].heat
    lanes = schema_module._heat_lanes(None, snapshot, snapshot.id)
    assert [lane.lane for lane in lanes] == [1, 2]
    assert (lanes[0].racer_id, lanes[0].time, lanes[0].place) == (racer_id, 3.25, 1)
    assert (lanes[1].racer_id, lanes[1].placeholder_slot) == (None, 1)


@pytest.mark.anyio
async def test_unclassified_publishes_still_say_something_changed(db):
    """Call sites that were not classified keep working, as OTHER."""
    race = _seed(db)

    async def act():
        await schema_module._publish_race_state(race.id)

    events = await _capture(race.id, act)
    assert events[0].kind is RaceChangeKind.OTHER
    assert events[0].heat is None
    assert events[0].racer is None
    assert events[0].race_id == race.id


def test_the_subscription_exposes_kind_and_payloads():
    """The fields must actually be in the schema, not just on the Python class."""
    sdl = schema.as_str()
    assert "type RaceStateChangedEvent" in sdl
    for field in ("kind: RaceChangeKind!", "heat: Heat", "racer: Racer"):
        assert field in sdl, f"missing {field} in RaceStateChangedEvent"
    assert "enum RaceChangeKind" in sdl
    kinds = ("HEAT_RESULT", "RACER", "ROSTER", "SCHEDULE", "RACE_SETTINGS", "OTHER")
    for value in kinds:
        assert value in sdl


def test_recording_a_result_through_graphql_publishes_a_heat_payload(client, db):
    """End to end through the mutation the operator actually fires."""
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Dee", last_name="D", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps([{"lane": 1, "racer_id": racer.id, "time": None}]),
    )
    db.add(heat)
    db.commit()
    heat_id = heat.id

    published = []
    original = schema_module._publish_race_state

    async def spy(*args, **kwargs):
        published.append(kwargs)
        return await original(*args, **kwargs)

    schema_module._publish_race_state = spy
    try:
        data = record_heat_result(
            client,
            heat_id,
            [{"lane": 1, "racer_id": racer.id, "time": 3.1, "place": 1}],
        )
        assert data["updateHeatResult"]["id"] == heat_id
    finally:
        schema_module._publish_race_state = original

    assert published, "the mutation published nothing"
    assert published[0]["kind"] is RaceChangeKind.HEAT_RESULT
    assert published[0]["heat"].id == heat_id
    assert published[0]["round_id"] == round_obj.id


def test_checking_a_racer_in_publishes_a_racer_payload(client, db):
    """The other high-frequency mutation, and the one that should stop
    making the stats and schedule views re-query anything."""
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Eve", last_name="E", race_id=race.id)
    )

    published = []
    original = schema_module._publish_race_state

    async def spy(*args, **kwargs):
        published.append(kwargs)
        return await original(*args, **kwargs)

    schema_module._publish_race_state = spy
    try:
        client.post(
            "/graphql",
            json={
                "query": f"mutation {{ checkInRacer(id: {racer.id}, "
                f"passedInspection: true, weight: 141.5) {{ id }} }}"
            },
        )
    finally:
        schema_module._publish_race_state = original

    assert published, "the mutation published nothing"
    assert published[0]["kind"] is RaceChangeKind.RACER
    assert published[0]["racer"].id == racer.id
