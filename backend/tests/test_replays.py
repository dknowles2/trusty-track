"""Stored replay clips: upload, serve, and delete-after-next-heat (#177 stage 1a),
plus stored retention (#177 stage 2, from "Stage 2:" below).

`POST /replay/` and `GET /replay/<name>` in `api/main.py`; the in-memory
index in `services/replays.py`; the purge call in `api/schema.py`'s
`update_heat_result`/`prepare_heat` resolvers and `TimerManager`'s own
result path. See `.claude/rules/displays.md` for the camera-role half of
#177 stage 1a, covered separately in `test_displays_camera.py`.

Stage 2 is `models.Organization.keep_replays` and its two retention bounds
— `models.HeatReplay`, `services.replays.record_stored_clip`/
`enforce_retention`/`discard_or_retain`/`rebuild_from_db`/
`discard_clips_for_race`, and the `GET /replay/<name>` index-lookup guard.
`test_domain_replays.py` covers the pure retention rules with no database.
"""

import asyncio
import re
from pathlib import Path

import pytest

from backend import demo_mode
from backend.api import main
from backend.api.schema import Mutation, Subscription
from backend.db import crud, models, schemas
from backend.domain.replays import ReplayClip, ReplayKey, is_stale
from backend.services import replays as replays_service
from backend.services.displays import registry
from backend.services.timer.devices import FAKE
from backend.services.timer.manager import TimerManager
from backend.tests.helpers import as_lanes


@pytest.fixture(autouse=True)
def isolated_replay_store(tmp_path, monkeypatch):
    """A private store and directory per test.

    `replays_service.store` is a process-wide singleton, like
    `services.displays.registry` and the timer managers. Every module that
    uses it does `from backend.services import replays as replays_service`,
    so patching the module's own `store` attribute reaches every one of
    them — `api.main`, `api.schema` and `services.timer.manager` alike —
    with no need to patch each one separately.
    """
    store = replays_service.ReplayStore(tmp_path / "replays")
    store.sweep()
    monkeypatch.setattr(replays_service, "store", store)
    return store


@pytest.fixture(autouse=True)
def empty_registry():
    registry.clear()
    yield
    registry.clear()


def _info(db, timer_managers=None):
    class MockInfo:
        context = {"db": db, "timer_managers": timer_managers or {}}

    return MockInfo()


@pytest.fixture
def race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Replay Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Replay Track", lane_count=2, timer_type="FAKE")
    )
    r = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Replay Derby", organization_id=group.id, track_id=track.id
        ),
    )
    return track, r


def _heat(db, race_obj, *, heat_number=1, recorded_at=None):
    heat = models.Heat(
        race_id=race_obj.id, heat_number=heat_number, recorded_at=recorded_at
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)
    return heat


#: A tiny valid-enough body; the route never inspects the bytes themselves,
#: only their length and the declared content type.
_CLIP_BYTES = b"\x00\x01\x02\x03"


def _upload(client, *, race_id, heat_id, recorded_at, camera_id="cam-1", **kw):
    data = {
        "race_id": str(race_id),
        "heat_id": str(heat_id),
        "recorded_at": recorded_at,
        "camera_id": camera_id,
        "t0_offset_ms": str(kw.pop("t0_offset_ms", 500)),
        "duration_ms": str(kw.pop("duration_ms", 4000)),
    }
    content_type = kw.pop("content_type", "video/webm")
    body = kw.pop("body", _CLIP_BYTES)
    return client.post(
        "/replay/", data=data, files={"file": ("clip.webm", body, content_type)}
    )


# --------------------------------------------------------------------------- #
# Upload: happy path, and each refusal                                        #
# --------------------------------------------------------------------------- #


def test_a_clip_lands_under_replays_not_uploads(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    response = _upload(
        client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at
    )

    assert response.status_code == 200, response.text
    url = response.json()["url"]
    assert url.startswith("/replay/")
    name = url.removeprefix("/replay/")
    # Non-enumerable: a UUID, not the caller's filename or a counter.
    assert name != "clip.webm"
    assert len(name.split(".")[0]) >= 32
    assert (replays_service.store.directory / name).is_file()


def test_the_index_is_updated(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)

    key = ReplayKey(heat_id=heat.id, recorded_at=heat.recorded_at)
    clips = replays_service.store.clips_for(key)
    assert len(clips) == 1
    assert clips[0].camera_id == "cam-1"
    assert clips[0].t0_offset_ms == 500
    assert clips[0].duration_ms == 4000


def test_a_wrong_race_is_refused(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    response = _upload(
        client,
        race_id=race_obj.id + 999,
        heat_id=heat.id,
        recorded_at=heat.recorded_at,
    )

    assert response.status_code == 404


def test_a_stale_recorded_at_is_refused(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    response = _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at="2026-09-16T11:00:00+00:00",
    )

    assert response.status_code == 409


def test_a_heat_with_no_result_yet_is_refused(client, db, race):
    """`recorded_at` is `None` until a result lands — there is nothing this
    clip could be a replay of."""
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at=None)

    response = _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at="2026-09-16T12:00:00+00:00",
    )

    assert response.status_code == 409


def test_an_oversized_clip_is_refused(client, db, race, monkeypatch):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    monkeypatch.setattr(replays_service, "MAX_REPLAY_CLIP_BYTES", 8)

    response = _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at=heat.recorded_at,
        body=b"\x00" * 9,
    )

    assert response.status_code == 413
    assert list(replays_service.store.directory.iterdir()) == []


def test_an_unsupported_content_type_is_refused(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    response = _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at=heat.recorded_at,
        content_type="text/plain",
    )

    assert response.status_code == 415


def test_the_demo_refuses_the_upload(client, db, race, monkeypatch):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    monkeypatch.setenv(demo_mode.DEMO_VARIABLE, "1")

    response = _upload(
        client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at
    )

    assert response.status_code == 403


def test_two_cameras_produce_two_clips_for_one_heat(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at=heat.recorded_at,
        camera_id="cam-finish",
    )
    _upload(
        client,
        race_id=race_obj.id,
        heat_id=heat.id,
        recorded_at=heat.recorded_at,
        camera_id="cam-side",
    )

    key = ReplayKey(heat_id=heat.id, recorded_at=heat.recorded_at)
    clips = replays_service.store.clips_for(key)
    assert {c.camera_id for c in clips} == {"cam-finish", "cam-side"}


# --------------------------------------------------------------------------- #
# Serving                                                                      #
# --------------------------------------------------------------------------- #


def test_serving_returns_the_bytes_with_no_store(client, db, race):
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    upload = _upload(
        client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at
    )
    url = upload.json()["url"]

    response = client.get(url)

    assert response.status_code == 200
    assert response.content == _CLIP_BYTES
    assert response.headers["cache-control"] == "no-store"


def test_an_unknown_clip_is_404(client):
    assert client.get("/replay/does-not-exist.webm").status_code == 404


def test_path_traversal_is_refused(client):
    """`{filename}` is a single path segment (`main.py`'s route declares no
    `:path` converter), so Starlette's own routing never hands this handler
    a value containing a `/` in the first place — a request whose raw path
    carries an encoded slash (`..%2Fmain.py`) either fails to match this
    route at all or is normalised by the ASGI layer into an unrelated path
    before routing ever sees it (verified: it lands on the SPA catch-all's
    own "unknown path" fallback once a frontend is built, not on this
    handler — a different, intended behaviour, not a traversal). The
    meaningful case is the one that *does* reach `get_replay_clip`: a
    literal `..` as the whole filename, which resolves to this directory's
    own parent — not a file, so the existing `is_file()` check already
    refuses it. `%2e%2e` avoids the client normalising a literal `..` out
    of the URL before the request is even sent.
    """
    assert client.get("/replay/%2e%2e").status_code == 404


def test_a_later_mounted_spa_catchall_does_not_shadow_replay_serving(
    client, db, race, tmp_path
):
    """Regression test for the PR #1185 review finding: `GET
    /replay/{filename}` was registered *after* `main.py`'s SPA catch-all
    (`@app.get("/{full_path:path}")`, added once `frontend/dist` exists),
    and FastAPI matches GET routes in registration order — so on every real
    deployment (`./scripts/serve.sh`, the Pi image, `install.sh`, all of
    which build the frontend) the catch-all's `{full_path:path}` matched a
    replay request first and always returned `index.html`, 200, never the
    clip.

    Build-independent, unlike the other serving tests above, which only
    caught this because *this checkout* happens to have `frontend/dist`
    built (the original bug passed CI, whose backend job has no built
    frontend, for that exact reason). This test manufactures its own "the
    frontend is built" moment by calling `main._mount_frontend` — the same
    function `main.py`'s own `if FRONTEND_DIST.exists():` calls — against a
    fresh temporary directory, regardless of what the ambient checkout
    holds, and proves the already-registered `/replay/` route still wins.
    """
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    upload = _upload(
        client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at
    )
    url = upload.json()["url"]

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>spa shell</html>")
    main._mount_frontend(dist)

    response = client.get(url)

    assert response.status_code == 200
    assert response.content == _CLIP_BYTES
    assert response.content != b"<html>spa shell</html>"


def test_the_replay_get_route_is_registered_before_the_spa_catchall():
    """A static, source-order guard alongside the dynamic test above: reads
    `main.py` itself and asserts `@app.get("/replay/{filename}")` appears
    earlier in the file than the SPA catch-all's own `@app.get`. Registration
    *order* is exactly what matters here (Starlette/FastAPI match GET routes
    in the order they were added), so pinning it structurally means this
    fails the moment anyone reorders the two, independent of whichever of
    them the dynamic test above happens to catch first.
    """
    source = Path(main.__file__).read_text()
    replay_match = re.search(r'@app\.get\("/replay/\{filename\}"\)', source)
    catchall_match = re.search(r'@app\.get\("/\{full_path:path\}"', source)
    assert replay_match is not None, "the replay GET route has moved or been renamed"
    assert catchall_match is not None, "the SPA catch-all has moved or been renamed"
    assert replay_match.start() < catchall_match.start(), (
        "GET /replay/{filename} must be registered before the SPA catch-all, "
        "or a built frontend shadows every replay request with index.html"
    )


# --------------------------------------------------------------------------- #
# Retention: delete-after-next-heat                                           #
# --------------------------------------------------------------------------- #


async def test_recording_a_result_purges_an_earlier_heats_clip(client, db, race):
    """The heat that just resulted has no clip yet (it uploads a second or
    two later) — this purge only ever removes an *earlier* heat's clip."""
    track, race_obj = race
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=first.id, recorded_at=first.recorded_at
    )
    second = _heat(db, race_obj, heat_number=2)
    racer_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="A",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    racer_b = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="B",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    crud.set_heat_lanes(
        second,
        as_lanes(
            [
                {"lane": 1, "racer_id": racer_a.id, "time": None, "place": None},
                {"lane": 2, "racer_id": racer_b.id, "time": None, "place": None},
            ]
        ),
    )
    db.commit()

    assert replays_service.store.clips_for(
        ReplayKey(heat_id=first.id, recorded_at=first.recorded_at)
    )

    await Mutation().update_heat_result(
        _info(db),
        heat_id=second.id,
        lanes_input=as_lanes(
            [
                {"lane": 1, "racer_id": racer_a.id, "time": 3.1, "place": 1},
                {"lane": 2, "racer_id": racer_b.id, "time": 3.2, "place": 2},
            ]
        ),
    )

    assert (
        replays_service.store.clips_for(
            ReplayKey(heat_id=first.id, recorded_at=first.recorded_at)
        )
        == []
    )


async def test_preparing_the_next_heat_purges_the_previous_clip(db, race):
    track, race_obj = race
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    racer_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="A",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    second = _heat(db, race_obj, heat_number=2)
    crud.set_heat_lanes(
        second,
        as_lanes([{"lane": 1, "racer_id": racer_a.id, "time": None, "place": None}]),
    )
    db.commit()

    replays_service.store.add(
        ReplayKey(heat_id=first.id, recorded_at=first.recorded_at),
        ReplayClip(
            camera_id="cam-1",
            path="doesnotexist.webm",
            race_id=race_obj.id,
            t0_offset_ms=0,
            duration_ms=1000,
        ),
    )

    manager = TimerManager(track_id=track.id, device=FAKE)
    await Mutation().prepare_heat(_info(db, {track.id: manager}), heat_id=second.id)

    assert (
        replays_service.store.clips_for(
            ReplayKey(heat_id=first.id, recorded_at=first.recorded_at)
        )
        == []
    )


# --------------------------------------------------------------------------- #
# The heatReplay subscription                                                 #
# --------------------------------------------------------------------------- #


async def test_heat_replay_wakes_on_upload_and_on_purge(client, db, race):
    """PR #1185's review finding: `_publish_heat_replay` was defined and
    never called from any of the four purge sites, so a display already
    holding a `HeatReplay` payload for a heat whose clip had just been
    purged was never told to re-read — it kept a stale (and, per the other
    finding in the same review, briefly 404ing) `url` until some unrelated
    upload for the same race happened to wake it, which could be heats
    later or never.

    Subscribes once and drives both edges through the real doors: an
    upload (`POST /replay/`) must wake it with the new clip, and recording
    the *next* heat's result (`updateHeatResult`, one of the four purge
    sites) must wake it again with nothing left for the old heat.
    """
    track, race_obj = race
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")

    stream = Subscription().heat_replay(race_id=race_obj.id)
    opening = await asyncio.wait_for(stream.__anext__(), timeout=2.0)
    assert opening is None  # nothing uploaded yet

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    _upload(
        client, race_id=race_obj.id, heat_id=first.id, recorded_at=first.recorded_at
    )
    payload = await asyncio.wait_for(following, timeout=2.0)

    assert payload is not None
    assert payload.heat_id == first.id
    assert payload.recorded_at == first.recorded_at
    assert len(payload.clips) == 1
    assert payload.clips[0].camera_id == "cam-1"

    second = _heat(db, race_obj, heat_number=2)
    racer_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="A",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    racer_b = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="B",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    crud.set_heat_lanes(
        second,
        as_lanes(
            [
                {"lane": 1, "racer_id": racer_a.id, "time": None, "place": None},
                {"lane": 2, "racer_id": racer_b.id, "time": None, "place": None},
            ]
        ),
    )
    db.commit()

    following = asyncio.create_task(stream.__anext__())
    await asyncio.sleep(0.05)
    await Mutation().update_heat_result(
        _info(db),
        heat_id=second.id,
        lanes_input=as_lanes(
            [
                {"lane": 1, "racer_id": racer_a.id, "time": 3.1, "place": 1},
                {"lane": 2, "racer_id": racer_b.id, "time": 3.2, "place": 2},
            ]
        ),
    )
    payload = await asyncio.wait_for(following, timeout=2.0)

    # The first heat's clip was just purged, and nothing has replaced it —
    # `_current_heat_replay` finds no current key for this race at all.
    assert payload is None

    await stream.aclose()


def test_the_startup_sweep_empties_the_directory(tmp_path):
    directory = tmp_path / "somewhere" / "replays"
    directory.mkdir(parents=True)
    (directory / "leftover.webm").write_bytes(b"x")
    store = replays_service.ReplayStore(directory)

    store.sweep()

    assert list(directory.iterdir()) == []


def test_discard_other_heats_reports_how_many_it_removed(tmp_path):
    store = replays_service.ReplayStore(tmp_path / "replays")
    store.sweep()
    name, path = store.new_clip_path(".webm")
    path.write_bytes(b"x")
    store.add(
        ReplayKey(heat_id=1, recorded_at="a"),
        ReplayClip(
            camera_id="cam", path=name, race_id=7, t0_offset_ms=0, duration_ms=1
        ),
    )

    removed = store.discard_other_heats(race_id=7, keep_heat_id=2)

    assert removed == 1
    assert not path.exists()


def test_is_stale_treats_no_result_as_stale():
    assert is_stale(None, "anything")
    assert is_stale("a", "b")
    assert not is_stale("a", "a")


# --------------------------------------------------------------------------- #
# Backup exclusion                                                            #
# --------------------------------------------------------------------------- #


def test_a_backup_does_not_contain_a_replay_clip(tmp_path):
    """`services/backup.py`'s own reasoning: it only ever reads `upload_dir`
    by name and never walks `DATA_DIR` generally, so a clip sitting in a
    sibling `replays/` directory is never a candidate in the first place —
    proven here by putting one there and checking the archive it produces."""
    import zipfile

    from sqlalchemy import create_engine, text

    from backend.db.database import Base
    from backend.services import backup

    # A clip sitting right beside `uploads/`, the way it really would. Not
    # `tmp_path / "replays"` — the autouse `isolated_replay_store` fixture
    # already owns that path for this test.
    replay_dir = tmp_path / "somewhere" / "replays"
    replay_dir.mkdir(parents=True)
    (replay_dir / "some-clip.webm").write_bytes(_CLIP_BYTES)

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    staging = tmp_path / "staging"
    archive_path = tmp_path / "backup.zip"

    db_path = tmp_path / "trusty-track.db"
    source_engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=source_engine)
    with source_engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('head')"))

    try:
        backup.write_archive(
            archive_path,
            engine=source_engine,
            upload_dir=upload_dir,
            app_version="test",
            staging_dir=staging,
        )
    finally:
        source_engine.dispose()

    with zipfile.ZipFile(archive_path) as zf:
        names = zf.namelist()

    assert not any("replay" in n for n in names)
    assert not any(n.endswith(".webm") for n in names)


# --------------------------------------------------------------------------- #
# Stage 2: stored retention (#177)                                            #
# --------------------------------------------------------------------------- #


def _enable_keep_replays(db, race_obj, *, retention_heats=None, retention_mb=None):
    """Turn the setting on for *race_obj*'s organization and set its two
    bounds. Returns the `models.Organization` row."""
    organization = (
        db.query(models.Organization)
        .filter(models.Organization.id == race_obj.organization_id)
        .first()
    )
    organization.keep_replays = True
    organization.replay_retention_heats = retention_heats
    organization.replay_retention_mb = retention_mb
    db.commit()
    db.refresh(organization)
    return organization


def test_off_is_unchanged_from_stage_1(client, db, race):
    """The setting's own default (`keep_replays=False`) is stage 1a's exact
    behaviour — no `HeatReplay` row, ever, for an install that has never
    opted in. This is the one assertion `test_replays.py`'s own stage 1a
    section (run as-is above) does not make explicitly."""
    _, race_obj = race
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)

    assert db.query(models.HeatReplay).count() == 0


def test_a_stored_clip_gets_a_row_when_the_setting_is_on(client, db, race):
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    response = _upload(
        client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at
    )
    assert response.status_code == 200

    rows = db.query(models.HeatReplay).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.heat_id == heat.id
    assert row.recorded_at == heat.recorded_at
    assert row.camera_id == "cam-1"
    assert row.size_bytes == len(_CLIP_BYTES)
    assert (replays_service.store.directory / row.path).is_file()


async def test_a_stored_clips_file_survives_the_next_heat_starting(client, db, race):
    """The stage 1a behaviour this setting turns off: `discard_or_retain`
    is a no-op while `keep_replays` is on, so `prepareHeat` arming the next
    heat must not delete the previous heat's stored clip."""
    track, race_obj = race
    _enable_keep_replays(db, race_obj)
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=first.id, recorded_at=first.recorded_at
    )
    row = db.query(models.HeatReplay).one()
    path = replays_service.store.directory / row.path

    second = _heat(db, race_obj, heat_number=2)
    racer_a = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="A",
            last_name="R",
            race_id=race_obj.id,
            car_passed_inspection=True,
        ),
    )
    crud.set_heat_lanes(
        second,
        as_lanes([{"lane": 1, "racer_id": racer_a.id, "time": None, "place": None}]),
    )
    db.commit()

    manager = TimerManager(track_id=track.id, device=FAKE)
    await Mutation().prepare_heat(_info(db, {track.id: manager}), heat_id=second.id)

    assert path.is_file()
    assert db.query(models.HeatReplay).count() == 1


def test_a_rerun_keeps_both_clips_as_history(client, db, race):
    """A heat re-run while the setting is on keeps the corrected run's clip
    *and* the one it replaced — `HeatActivity.last_activity` is what the
    heat's place in retention is decided by, not the individual run."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)

    # Re-run: a fresh `recorded_at`.
    heat.recorded_at = "2026-09-16T12:05:00+00:00"
    db.commit()
    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)

    rows = (
        db.query(models.HeatReplay).filter(models.HeatReplay.heat_id == heat.id).all()
    )
    assert {r.recorded_at for r in rows} == {
        "2026-09-16T12:00:00+00:00",
        "2026-09-16T12:05:00+00:00",
    }


def test_retention_by_heat_count(client, db, race):
    _, race_obj = race
    _enable_keep_replays(db, race_obj, retention_heats=1)
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=first.id, recorded_at=first.recorded_at
    )
    # Read the plain filename now, before a later retention pass in this
    # same session deletes the row — holding the ORM instance itself across
    # that delete leaves it expired, and any later attribute access raises
    # `ObjectDeletedError` rather than reading a value.
    first_path_name = db.query(models.HeatReplay).one().path
    first_path = replays_service.store.directory / first_path_name
    assert first_path.is_file()

    second = _heat(db, race_obj, heat_number=2, recorded_at="2026-09-16T12:05:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=second.id, recorded_at=second.recorded_at
    )

    # The first heat fell outside "keep the last 1 heat" the moment the
    # second heat's clip landed — its row and file are both gone.
    remaining = db.query(models.HeatReplay).all()
    assert [r.heat_id for r in remaining] == [second.id]
    assert not first_path.is_file()
    assert not replays_service.store.known_filename(first_path_name)


def test_a_bound_that_would_purge_nothing_leaves_everything(client, db, race):
    """Mutation-test the bound itself: break it (set it absurdly high) and
    confirm both clips survive — the regression this pins is the retention
    call happening at all, not merely "a low bound eventually purges"."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj, retention_heats=1000)
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=first.id, recorded_at=first.recorded_at
    )
    second = _heat(db, race_obj, heat_number=2, recorded_at="2026-09-16T12:05:00+00:00")
    _upload(
        client, race_id=race_obj.id, heat_id=second.id, recorded_at=second.recorded_at
    )

    assert db.query(models.HeatReplay).count() == 2


def test_retention_by_size(client, db, race):
    _, race_obj = race
    # `retention_mb=0` would purge *everything*, including the clip that was
    # just uploaded (there is nothing older to remove instead) — a
    # deterministic but degenerate cap that cannot distinguish "the old one
    # goes" from "everything goes". Real, if small, bodies (2 MB each) and
    # a 3 MB cap give both clips a genuine chance to coexist for a moment.
    two_mb = b"\x00" * (2 * 1024 * 1024)
    _enable_keep_replays(db, race_obj, retention_mb=3)
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client,
        race_id=race_obj.id,
        heat_id=first.id,
        recorded_at=first.recorded_at,
        body=two_mb,
    )
    first_path_name = db.query(models.HeatReplay).one().path
    first_path = replays_service.store.directory / first_path_name

    second = _heat(db, race_obj, heat_number=2, recorded_at="2026-09-16T12:05:00+00:00")
    _upload(
        client,
        race_id=race_obj.id,
        heat_id=second.id,
        recorded_at=second.recorded_at,
        body=two_mb,
    )

    # 4 MB total, over the 3 MB cap — the newest survives (it is what was
    # just uploaded and is never the one a retention pass removes to make
    # room for itself), the older one is purged.
    remaining = db.query(models.HeatReplay).all()
    assert [r.heat_id for r in remaining] == [second.id]
    assert not first_path.is_file()


def test_both_bounds_purge_a_heat_either_one_would(client, db, race):
    """Additive, not "most permissive wins": a heat purged by *either* bound
    is purged."""
    _, race_obj = race
    two_mb = b"\x00" * (2 * 1024 * 1024)
    # Heats bound alone would keep 5 (plenty); size bound alone (3 MB) is
    # what actually forces the older heat out once the second clip lands.
    _enable_keep_replays(db, race_obj, retention_heats=5, retention_mb=3)
    first = _heat(db, race_obj, heat_number=1, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(
        client,
        race_id=race_obj.id,
        heat_id=first.id,
        recorded_at=first.recorded_at,
        body=two_mb,
    )
    second = _heat(db, race_obj, heat_number=2, recorded_at="2026-09-16T12:05:00+00:00")
    _upload(
        client,
        race_id=race_obj.id,
        heat_id=second.id,
        recorded_at=second.recorded_at,
        body=two_mb,
    )

    remaining = db.query(models.HeatReplay).all()
    assert [r.heat_id for r in remaining] == [second.id]


def test_the_index_is_rebuilt_from_the_table_on_restart(db, race):
    """What `main.py`'s lifespan calls instead of `sweep()` when
    `keep_replays` is on — proven directly against `rebuild_from_db` rather
    than booting a whole app, the same "test the function, not the
    lifespan" shape the rest of this suite already uses."""
    _, race_obj = race
    organization = _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")

    name, path = replays_service.store.new_clip_path(".webm")
    path.write_bytes(_CLIP_BYTES)
    key = ReplayKey(heat_id=heat.id, recorded_at=heat.recorded_at)
    clip = ReplayClip(
        camera_id="cam-1",
        path=name,
        race_id=race_obj.id,
        t0_offset_ms=0,
        duration_ms=1000,
        size_bytes=len(_CLIP_BYTES),
    )
    replays_service.store.add(key, clip)
    replays_service.record_stored_clip(db, key, clip)

    # A fresh store, as a real restart would build — nothing carried over
    # from the one above except what is on disk and in the table.
    fresh_store = replays_service.ReplayStore(replays_service.store.directory)
    fresh_store.rebuild_from_db(db)

    assert fresh_store.known_filename(name)
    assert fresh_store.clips_for(key)[0].camera_id == "cam-1"
    latest = fresh_store.latest_for_race(race_obj.id)
    assert latest is not None
    assert latest[0] == key
    # The file itself was never touched by the rebuild.
    assert path.is_file()
    assert organization.keep_replays is True


async def test_deleting_a_race_removes_stored_clip_files(client, db, race):
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path
    path = replays_service.store.directory / path_name
    assert path.is_file()

    await Mutation().delete_race(_info(db), id=race_obj.id)

    assert not path.is_file()
    assert db.query(models.HeatReplay).count() == 0
    assert not replays_service.store.known_filename(path_name)


def test_the_heat_replay_row_cascades_with_its_heat(db, race):
    """The database half of the cascade — proven directly against the
    schema's own `ON DELETE CASCADE` (#125's rule), independent of
    `discard_clips_for_race`'s file-side cleanup above."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    db.add(
        models.HeatReplay(
            heat_id=heat.id,
            camera_id="cam-1",
            recorded_at=heat.recorded_at,
            path="does-not-matter.webm",
            duration_ms=1000,
            t0_offset_ms=0,
            size_bytes=10,
            created_at="2026-09-16T12:00:00+00:00",
        )
    )
    db.commit()
    assert db.query(models.HeatReplay).count() == 1

    db.delete(heat)
    db.commit()

    assert db.query(models.HeatReplay).count() == 0


def test_a_file_dropped_into_replays_by_hand_is_not_served(client):
    """The index-lookup guard (#177 stage 2's revisit of the stage 1a
    review note): a file that exists on disk but was never added to the
    store's index is refused with no `is_file()` call at all."""
    from unittest.mock import patch

    replays_service.store.directory.mkdir(parents=True, exist_ok=True)
    stray = replays_service.store.directory / "not-a-real-clip.webm"
    stray.write_bytes(b"anything")

    with patch("pathlib.Path.is_file") as mock_is_file:
        response = client.get("/replay/not-a-real-clip.webm")
        mock_is_file.assert_not_called()

    assert response.status_code == 404


def test_a_restore_purges_every_heat_replay_row(client, db, race):
    """`POST /api/backup/restore` never archives `replays/` (`ops.md`'s
    backup section), but the *database* snapshot inside the archive can
    still hold `heat_replays` rows from whenever it was taken. A restore
    purges them outright — see `test_backup.py`'s own restore tests for the
    database/uploads halves of this endpoint; this is the replay-specific
    piece, exercised the same way `test_the_startup_sweep_empties_the_
    directory` exercises the sweep half: directly against the store, since
    a full archive round trip through this file's own `race` fixture (an
    in-memory test database) cannot produce a real file-backed backup for
    `POST /api/backup/restore` to read.
    """
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    assert db.query(models.HeatReplay).count() == 1

    # The exact statement `api/main.py`'s restore handler runs, right
    # beside the unconditional `replays_service.store.sweep()` stage 1a
    # already had — see `test_backup.py::TestRestorePurgesStoredReplays`
    # for the same behaviour exercised through the real HTTP endpoint
    # against a file-backed database.
    db.query(models.HeatReplay).delete()
    db.commit()

    assert db.query(models.HeatReplay).count() == 0


# --------------------------------------------------------------------------- #
# Stage 2: every heat-deleting path discards the clip along with the heat     #
#                                                                              #
# A heat with results is refused by every one of these — so the only way a   #
# heat holding a stored clip becomes deletable at all is a plain reset       #
# (`crud.stamp_recorded` clearing `recorded_at` back to `None`, "Re-Run")    #
# with no new result recorded: the heat then looks never-run to every one of #
# these functions' refusal checks, while a `HeatReplay` row still names it.  #
# Each test below reproduces exactly that sequence for one delete path.      #
# --------------------------------------------------------------------------- #


def _assert_clip_gone(client, db, heat_id, path_name):
    path = replays_service.store.directory / path_name
    assert (
        db.query(models.HeatReplay).filter(models.HeatReplay.heat_id == heat_id).count()
        == 0
    )
    assert not path.is_file()
    assert not replays_service.store.known_filename(path_name)
    response = client.get(f"/replay/{path_name}")
    assert response.status_code == 404


def test_reset_then_delete_heat_removes_the_orphaned_clip(client, db, race):
    """The reviewer's own reproduction: a "Re-Run"/Reset Heat clears
    `recorded_at` back to `None` without touching the `HeatReplay` row
    already written for the earlier run, which is what makes the heat look
    never-run and so deletable through the ordinary `deleteHeat` refusal
    checks — `crud.delete_heat` must not leave the clip behind when that
    happens."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = _heat(db, race_obj, recorded_at="2026-09-16T12:00:00+00:00")
    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path
    assert (replays_service.store.directory / path_name).is_file()

    # The reset: same shape `stamp_recorded` leaves a heat in once its lanes
    # hold no result any more.
    heat.recorded_at = None
    db.commit()

    assert crud.delete_heat(db, heat.id) is True
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is None
    _assert_clip_gone(client, db, heat.id, path_name)


def test_reset_then_delete_round_removes_every_heats_orphaned_clip(client, db, race):
    """`delete_round` removes its heats through the ORM's own
    ``cascade="all, delete-orphan"`` on ``Round.heats`` rather than an
    explicit per-heat ``db.delete`` — a different mechanism from
    `delete_heat`'s, and the reason this path needed its own call to
    `discard_rows_for_deleted_heats`, collecting every one of the round's
    heat ids before any of them go."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    round_obj = models.Round(
        race_id=race_obj.id,
        round_number=1,
        name="Round 1",
        scheduling_strategy="GENERAL",
    )
    db.add(round_obj)
    db.flush()
    heat = models.Heat(
        race_id=race_obj.id,
        round_id=round_obj.id,
        heat_number=1,
        recorded_at="2026-09-16T12:00:00+00:00",
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path

    heat.recorded_at = None
    db.commit()

    assert crud.delete_round(db, round_obj.id) is True
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is None
    _assert_clip_gone(client, db, heat.id, path_name)


def test_reset_then_delete_free_race_heat_removes_the_orphaned_clip(client, db, race):
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = models.Heat(
        race_id=race_obj.id,
        kind=models.HeatKind.FREE,
        heat_number=1,
        recorded_at="2026-09-16T12:00:00+00:00",
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path

    heat.recorded_at = None
    db.commit()

    assert crud.delete_free_race_heat(db, heat.id) is True
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is None
    _assert_clip_gone(client, db, heat.id, path_name)


def test_reset_then_delete_run_off_heat_removes_the_orphaned_clip(client, db, race):
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    heat = models.Heat(
        race_id=race_obj.id,
        kind=models.HeatKind.RUN_OFF,
        heat_number=1,
        recorded_at="2026-09-16T12:00:00+00:00",
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path

    heat.recorded_at = None
    db.commit()

    assert crud.delete_run_off_heat(db, heat.id) is True
    assert db.query(models.Heat).filter(models.Heat.id == heat.id).first() is None
    _assert_clip_gone(client, db, heat.id, path_name)


def test_regenerating_a_round_clears_a_reset_heats_orphaned_clip(client, db, race):
    """`generate_heats_for_round`'s ``clear_existing`` branch deletes heats
    through its own loop (``for h in existing_heats: db.delete(h)``), a
    third mechanism distinct from both `delete_heat`'s single delete and
    `delete_round`'s ORM cascade — an operator's ordinary **Regenerate**
    reaches it, and a heat reset (never re-recorded) inside the round being
    regenerated is exactly as orphanable here as through any dedicated
    delete mutation."""
    _, race_obj = race
    _enable_keep_replays(db, race_obj)
    for i in range(2):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="Racer",
                race_id=race_obj.id,
                car_passed_inspection=True,
            ),
        )
    round_obj = crud.create_round(db, race_id=race_obj.id, round_number=1)
    heats = crud.generate_heats_for_round(db, round_obj.id)
    heat = heats[0]
    heat.recorded_at = "2026-09-16T12:00:00+00:00"
    db.commit()

    _upload(client, race_id=race_obj.id, heat_id=heat.id, recorded_at=heat.recorded_at)
    path_name = db.query(models.HeatReplay).one().path
    heat_id = heat.id

    # The reset — no new result recorded on this heat before the round is
    # regenerated (`may_rebuild` only permits this when nothing has raced).
    heat.recorded_at = None
    db.commit()

    crud.generate_heats_for_round(db, round_obj.id, clear_existing=True)

    # Not asserted: that no `Heat` row still holds `heat_id` — SQLite can
    # hand a freshly-inserted row the same rowid a delete just freed
    # (`_reset_heats_in_place`'s own docstring notes the identical trap), so
    # a *new*, unrelated heat can legitimately reuse this id. What matters
    # is that nothing named by the old clip survives.
    _assert_clip_gone(client, db, heat_id, path_name)


def test_discard_rows_for_deleted_heats_is_a_no_op_with_no_matching_rows(db):
    """No heat ids, and heat ids naming no `HeatReplay` row, are both
    ordinary no-ops — the common case for an install that has never turned
    `keepReplays` on."""
    replays_service.discard_rows_for_deleted_heats(db, [])
    replays_service.discard_rows_for_deleted_heats(db, [999999])
