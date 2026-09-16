"""Stored replay clips: upload, serve, and delete-after-next-heat (#177 stage 1a).

`POST /replay/` and `GET /replay/<name>` in `api/main.py`; the in-memory
index in `services/replays.py`; the purge call in `api/schema.py`'s
`update_heat_result`/`prepare_heat` resolvers and `TimerManager`'s own
result path. See `.claude/rules/displays.md` for the camera-role half of
#177 stage 1a, covered separately in `test_displays_camera.py`.
"""

import pytest

from backend import demo_mode
from backend.api.schema import Mutation
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
    assert client.get("/replay/..%2Fmain.py").status_code == 404


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
