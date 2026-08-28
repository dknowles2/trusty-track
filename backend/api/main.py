"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import base64
import io
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path

import pillow_heif
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from strawberry.fastapi import GraphQLRouter

from backend import demo_content, demo_mode
from backend.api import auth
from backend.api.loaders import RequestLoaders
from backend.api.schema import schema
from backend.db import crud, models
from backend.db.database import (
    DATA_DIR,
    UPLOAD_DIR,
    SessionLocal,
    database_path,
    engine,
    init_db,
    known_revisions,
)
from backend.domain import audit
from backend.services import backup, printables
from backend.services.image_processing import convert_to_browser_safe_png
from backend.services.timer import devices
from backend.services.timer.manager import TimerManager, initialize_timer_managers
from backend.services.timer.proxy import ProxySession, WebSocketTransport

# Load environment variables from .env if present
load_dotenv()

# Register the HEIF/HEIC plugin so Pillow can open those files.
pillow_heif.register_heif_opener()

# Registry of TimerManager instances, keyed by track_id
TIMER_MANAGERS: dict[int, TimerManager] = {}

# The WebSocket and ProxySession currently "owning" a track's proxy timer. On
# a proxied track this socket *is* the timer, so a second connection to the
# same track_id — a second device, or a reload whose old socket has not gone
# away yet — is a second timer for the same device. Left alone that used to
# repoint `manager.set_write_fn()` and leave both sessions running: the first
# tab kept believing it was armed while its bytes went nowhere (#301).
#
# A takeover tears the outgoing session down itself — `ProxySession.close()`,
# which resets the write function and tells the manager the connection is
# down — *before* installing the new one, and removes the registry entry
# first so the outgoing connection's own `finally` does not repeat that
# teardown once its receive loop eventually notices the close. Two calls to
# `handle_disconnect()` would reset the *new* connection's write function
# back to the no-op, which is the bug this exists to close. The outgoing
# socket is also closed with an explicit code and reason, so the tab that
# lost the timer says so — but that is only for the person watching the
# screen; the manager's state is already settled by the time it happens.
TIMER_WS_CONNECTIONS: dict[int, tuple[WebSocket, ProxySession]] = {}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Handle application lifespan events.
    Ensures the database is initialized before the app starts serving requests.
    """
    logger.info("Initializing database...")
    try:
        init_db()
        logger.info("Database initialization complete.")
    except Exception as e:
        # An operator can read the log and the app is still there, which is why
        # this has always carried on. The demo has nobody to read it: its
        # storage is ephemeral, so a failure here means serving an empty or
        # half-migrated database to every visitor with nothing to say so.
        if demo_mode.enabled():
            raise
        logger.error(f"Failed to initialize database: {e}")
        # In a real production app, you might want to exit here

    # The demo builds its own event on first boot (see `backend/demo_content`).
    # Idempotent, because the flag says nothing about whether this container has
    # run before — an always-on host restarts with its data still there.
    if demo_mode.enabled():
        # `try`/`finally` rather than `with`: the suite substitutes a session
        # factory that delegates by `__getattr__` (conftest's
        # `timer_session_factory`), and `with` looks dunders up on the type, so
        # a context manager here is unusable from every test that reaches it.
        session = SessionLocal()
        try:
            if demo_content.is_seeded(session):
                logger.info("The demo is already seeded; leaving it alone.")
            else:
                race = demo_content.seed(session)
                logger.info("Seeded the demo with race %d (%s).", race.id, race.name)
        finally:
            session.close()

    # Trim the audit log (#219). At startup rather than per write: counting and
    # deleting on every mutation would put two statements in the path of every
    # heat result, and the table being briefly over its cap between restarts
    # costs nothing.
    try:
        with SessionLocal() as session:
            removed = crud.prune_audit_log(session)
        if removed:
            logger.info("Pruned %d old audit entries.", removed)
    except Exception as e:
        logger.error("Could not prune the audit log: %s", e)

    logger.info("Initializing timer managers...")
    try:
        await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)
        logger.info("Timer managers ready: %s", list(TIMER_MANAGERS.keys()))
    except Exception as e:
        logger.error(f"Failed to initialize timer managers: {e}")

    yield


app = FastAPI(lifespan=lifespan)


def allowed_origins() -> list[str]:
    """Origins the browser may call this server from.

    The wildcard default is the LAN install and is explained below. A public
    deployment sets ``TRUSTYTRACK_ALLOWED_ORIGINS`` to its own hostname: there
    the reasoning does not hold, because ``VIEWER`` is the no-credential
    default and a viewer can read a roster — every racer's name, and their
    photograph.

    A function so it can be tested. The value is read once at import because
    that is when the middleware is built; a caller changing the environment
    afterwards changes nothing, and pretending otherwise would be worse than
    not offering it.

    An empty or all-whitespace setting falls back to the wildcard rather than
    to an empty list. An empty list refuses *every* cross-origin request, which
    on a LAN install is indistinguishable from the app being broken — and the
    likeliest way to arrive at one is a deployment setting the variable to an
    empty string, which means "I did not configure this", not "refuse
    everybody".
    """
    configured = os.getenv("TRUSTYTRACK_ALLOWED_ORIGINS", "*")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return origins or ["*"]


ALLOWED_ORIGINS = allowed_origins()

app.add_middleware(
    CORSMiddleware,
    # `allow_origins=["*"]` with `allow_credentials=True` is rejected outright
    # by browsers — the wildcard is not permitted on a credentialed request — so
    # the old pairing was broken *and* permissive (#15). Nothing here uses
    # cookies: the operator PIN travels in a header on a same-origin request, so
    # credentials are off and the wildcard is honest. A display or a phone on
    # the venue wifi loads the served page from this origin; a wildcard here
    # does not widen what they can do, because the PIN is what the server checks.
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency
def get_db():
    """Yield a database session and ensure it's closed after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle
    _BASE_DIR = Path(sys._MEIPASS)  # type: ignore[attr-defined]
else:
    # Development mode: Path(__file__) is backend/api/main.py
    _BASE_DIR = Path(__file__).parent.parent.parent

FRONTEND_DIST = _BASE_DIR / "frontend" / "dist"

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")


def _role_for_request(db: Session, pin: str | None) -> auth.Role:
    """The caller's role, from the PIN they sent and the PINs that are set.

    Reads the single `Group` rather than taking a race — roles are install-wide,
    and an install has one group. No group yet (the first run, before the wizard
    has saved) means nothing is configured, so `role_for` returns operator.
    """
    group = db.query(models.Group).first()
    return auth.role_for(
        pin,
        operator_pin_hash=getattr(group, "operator_pin_hash", None),
        checkin_pin_hash=getattr(group, "checkin_pin_hash", None),
    )


async def get_graphql_context(
    request: Request = None,  # type: ignore[assignment]
    websocket: WebSocket = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
) -> dict:
    """Provide the database session, timer managers, loaders and the role.

    Strawberry hands this a `Request` for HTTP and a `WebSocket` for
    subscriptions, never both — so the PIN is read from whichever arrived. The
    socket carries it as a query parameter because `graphql-ws` has no headers
    of its own; the browser cannot set them on a WebSocket handshake.
    """
    if request is not None:
        pin = request.headers.get(auth.PIN_HEADER)
    elif websocket is not None:
        pin = websocket.query_params.get("pin")
    else:  # pragma: no cover - Strawberry always supplies one
        pin = None

    # Where the request came from, for the audit log (#219). Read here because
    # this is the only place that still holds the `Request`; by the time a
    # resolver runs there is nothing left to ask. `client` is None behind some
    # proxies and in the test client, and null is the honest answer then rather
    # than a placeholder that looks like an address.
    source_ip = None
    if request is not None and request.client is not None:
        source_ip = request.client.host
    elif websocket is not None and websocket.client is not None:
        source_ip = websocket.client.host

    return {
        "db": db,
        "source_ip": source_ip,
        # A callable, not a value: see `auth.resolve_role`. Only a mutation
        # asks, and working it out costs a query.
        "role_resolver": lambda: _role_for_request(db, pin),
        "timer_managers": TIMER_MANAGERS,
        "loaders": RequestLoaders(db),
        # Managers created mid-request (e.g. by createTrack) need a factory for
        # their own background writes; tests override this.
        "session_factory": SessionLocal,
    }


graphql_app = GraphQLRouter(schema, context_getter=get_graphql_context)
app.include_router(graphql_app, prefix="/graphql")
# In production the built frontend sends requests to /api/graphql (the Vite dev
# proxy rewrites /api/* → /* so /graphql above handles dev; this covers production).
app.include_router(graphql_app, prefix="/api/graphql")


@app.get("/health")
async def health() -> dict:
    """Return application health status."""
    try:
        from ..version import __version__ as _version
    except ImportError:
        _version = "unknown"
    return {"status": "ok", "version": _version}


# Both paths, for the same reason `/graphql` is mounted twice: the built
# frontend asks for `/api/printables/...`, and the Vite dev proxy strips the
# `/api` before forwarding. Registering only the `/api` form makes the print
# page work in production and 404 in development, which is where it is written.
@app.get("/printables/barcode/{racer_id}.png")
@app.get("/api/printables/barcode/{racer_id}.png")
def check_in_barcode(racer_id: int, db: Session = Depends(get_db)) -> Response:
    """The QR code that takes a check-in operator straight to this racer.

    REST rather than GraphQL because the response is an image — the print page
    puts it in an `<img src>` and the browser handles the rest, including
    caching sixty of them while a sheet renders.

    The rest of a printable — the pit pass, the licence, the sheet they sit on —
    is HTML the browser prints. A QR code is the one part a page cannot draw
    without another dependency, so it is the only part that comes from here.
    """
    racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if racer is None:
        raise HTTPException(status_code=404, detail="Racer not found")

    return Response(
        content=printables.check_in_png(racer.race_id, racer.id),
        media_type="image/png",
        # The payload is derived from two ids that cannot change for a racer, so
        # the image is immutable. Worth saying: a roster sheet is sixty of these
        # and the operator will reprint it more than once.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/printables/vote-qr/{race_id}.png")
@app.get("/api/printables/vote-qr/{race_id}.png")
def voting_qr(race_id: int, url: str, db: Session = Depends(get_db)) -> Response:
    """A QR code a phone can scan to reach this race's ballot (#414).

    `url` is supplied by the caller rather than built here: the Awards page
    already works out the one address a phone can actually reach —
    substituting a LAN address for `localhost` when the browser's own origin
    would not do — and encoding a second copy of that logic here would be the
    two ways of getting a share address disagreeing with each other. Scoped
    to `race_id` only to reject a code for an obviously unrelated URL; this is
    not a general-purpose QR generator.

    Not cached `immutable` like the check-in code above: the address depends
    on the machine's current network, which can change between requests in a
    way a racer's id never does.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    if f"/race/{race_id}/vote" not in url:
        raise HTTPException(
            status_code=400, detail="Not a ballot address for this race"
        )

    return Response(
        content=printables.url_png(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


def _refuse_on_demo(what: str) -> None:
    """Refuse a REST route the public demo does not offer.

    ``RolePolicyExtension`` and ``DemoPolicyExtension`` guard GraphQL mutations
    and these routes are not GraphQL, so each makes its own check — the same
    reason the backup endpoints and the timer socket call
    :func:`_require_operator` for themselves (#15).
    """
    if demo_mode.enabled():
        raise HTTPException(status_code=403, detail=f"{what} is disabled on the demo")


def _require_checkin(request: Request, db: Session) -> None:
    """Refuse a caller who is not at least the registration desk.

    Weaker than :func:`_require_operator` on purpose: this guards the upload
    route, whose GraphQL twin ``uploadImage`` is classified as a ``CHECKIN``
    mutation. Requiring the operator here would be stricter than the mutation
    that does the same thing, and the desk is exactly who photographs a car.
    """
    if _role_for_request(db, request.headers.get(auth.PIN_HEADER)) is auth.Role.VIEWER:
        raise HTTPException(status_code=403, detail="Check-in PIN required")


def _require_operator(request: Request, db: Session) -> None:
    """Refuse anyone but the operator, for a route the role policy cannot see.

    `RolePolicyExtension` guards GraphQL mutations and these are not GraphQL, so
    the check is made here for the same reason the timer socket makes its own
    (#15). Backup is operator-only in both directions: the archive holds every
    racer's name and photograph, and a restore replaces the running event.
    """
    if _role_for_request(db, request.headers.get(auth.PIN_HEADER)) is not (
        auth.Role.OPERATOR
    ):
        raise HTTPException(status_code=403, detail="Operator PIN required")


def _staging_dir() -> Path:
    """Scratch space beside the data it is staging.

    Inside the data directory rather than the system temp directory so that
    `os.replace` is a rename rather than a copy across filesystems — on a Pi the
    two are usually different devices, and a cross-device restore would copy the
    database twice and lose the atomicity the rename gives.
    """
    return Path(DATA_DIR) / ".backup-staging"


# Both paths, as with the printables barcode above: the built frontend asks for
# `/api/...` and the Vite dev proxy strips the prefix before forwarding.
@app.get("/backup")
@app.get("/api/backup")
def download_backup(request: Request, db: Session = Depends(get_db)) -> FileResponse:
    """The whole event as one file: the database and every photograph.

    REST rather than GraphQL because the response is a zip. Streamed from a
    temporary file rather than built in memory — an archive is a database plus
    sixty photographs, and the machine this runs on has a gigabyte of RAM.
    """
    # Zip-the-world on demand, behind no credential on a demo where nobody sets
    # a PIN: CPU and disk amplification, for an archive of invented data.
    _refuse_on_demo("Downloading a backup")
    _require_operator(request, db)

    path = database_path()
    if path is None:
        raise HTTPException(
            status_code=503,
            detail="This install does not store its data in a file, so it "
            "cannot be backed up here.",
        )

    try:
        from ..version import __version__ as app_version
    except ImportError:  # pragma: no cover - version is generated at build time
        app_version = "unknown"

    staging = _staging_dir()
    staging.mkdir(parents=True, exist_ok=True)
    archive_path = staging / f"trusty-track-backup-{uuid.uuid4().hex}.zip"

    manifest = backup.write_archive(
        archive_path,
        engine=engine,
        upload_dir=Path(UPLOAD_DIR),
        app_version=app_version,
        staging_dir=staging,
    )

    # An archive holds every racer's name and photograph, so leaving the
    # building is worth a line (#219).
    crud.record_audit(
        db,
        "backupDownloaded",
        role=audit.ActorRole.OPERATOR.value,
        source_ip=request.client.host if request.client else None,
        details={"uploadCount": manifest.upload_count},
    )

    stamp = manifest.created_at.replace(":", "").replace("-", "")[:15]
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=f"trusty-track-backup-{stamp}.zip",
        # The archive exists only to be sent. Deleting it after the response
        # keeps a series of backups from filling the card they protect.
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@app.post("/backup/restore")
@app.post("/api/backup/restore")
async def restore_backup(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Replace the running event with the contents of an archive.

    Destructive and deliberately so — the confirmation belongs to the client,
    which is the only place that can ask a person. What this owes them is that a
    refusal costs nothing: `restore_archive` validates the manifest, checks the
    schema version and unpacks every member before it moves anything, so a
    damaged or too-new archive leaves the event exactly as it was.

    The database that was replaced is kept beside the new one with a
    `.pre-restore` suffix, and the uploads directory likewise.
    """
    # Replaces every racer and result from an anonymous upload. The demo resets
    # itself; it does not take a new instance from a visitor.
    _refuse_on_demo("Restoring a backup")
    _require_operator(request, db)

    path = database_path()
    if path is None:
        raise HTTPException(
            status_code=503,
            detail="This install does not store its data in a file, so it "
            "cannot be restored here.",
        )

    # The request's own session holds a connection to the database that is about
    # to be replaced. Close it before the swap rather than after.
    db.close()

    # Timer managers hold serial ports and write through their own sessions
    # (#9), and the track ids they are keyed on are about to change. Stop them
    # before the swap; they are rebuilt from the restored tracks below.
    for manager in list(TIMER_MANAGERS.values()):
        try:
            await manager.stop()
        except Exception as exc:  # pragma: no cover - best effort teardown
            logger.warning("Timer manager did not stop cleanly: %s", exc)
    TIMER_MANAGERS.clear()

    try:
        manifest = backup.restore_archive(
            file.file,
            database_path=path,
            upload_dir=Path(UPLOAD_DIR),
            staging_dir=_staging_dir(),
            known_revisions=known_revisions(),
            dispose=engine.dispose,
        )
    except backup.ArchiveError as exc:
        # Nothing was moved, so the event is untouched — but the managers were
        # stopped, so put them back before reporting the refusal.
        await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # An older archive is restored as it was and then upgraded, which is the
    # same path a pre-Alembic database already takes at startup.
    init_db()
    await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)

    # Recorded *after* the swap and through a new session, which is the whole
    # subtlety here: the request's own session was closed and its database has
    # been moved aside, so an entry written any earlier would be filed in the
    # copy nobody will ever open again. This one belongs in the database that
    # now exists, where somebody looking for "why is this not my event" will
    # actually find it.
    try:
        with SessionLocal() as session:
            crud.record_audit(
                session,
                "backupRestored",
                role=audit.ActorRole.OPERATOR.value,
                source_ip=request.client.host if request.client else None,
                details={
                    "createdAt": manifest.created_at,
                    "appVersion": manifest.app_version,
                    "uploadCount": manifest.upload_count,
                },
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not record the restore in the audit log: %s", exc)

    return {
        "restored": True,
        "created_at": manifest.created_at,
        "app_version": manifest.app_version,
        "upload_count": manifest.upload_count,
    }


# Both paths, as with the backup endpoints above: the built frontend asks for
# `/api/...` and the Vite dev proxy strips the prefix before forwarding.
@app.get("/timer-test/{track_id}/report")
@app.get("/api/timer-test/{track_id}/report")
def timer_test_report(
    track_id: int, request: Request, db: Session = Depends(get_db)
) -> JSONResponse:
    """The timer test report, as a file the operator can attach to an issue (#235).

    One JSON document carrying everything a profile fix needs: the app
    version, which profile matched and its provenance, the port framing, and
    the whole timestamped serial conversation — the same kind of evidence as
    the recordings in ``backend/tests/timer_recordings/``, which is what lets
    a good report become a regression fixture.

    REST rather than GraphQL because the answer is a download. Operator-only
    and self-guarding, like the backup endpoints: the role policy covers
    mutations, and this is neither.
    """
    _require_operator(request, db)

    mgr = TIMER_MANAGERS.get(track_id)
    if mgr is None:
        raise HTTPException(status_code=404, detail="No timer for that track")
    track = crud.get_track(db, track_id)

    try:
        from ..version import __version__ as app_version
    except ImportError:  # pragma: no cover - version is generated at build time
        app_version = "unknown"

    report = {
        "app_version": app_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "track": {
            "id": track_id,
            "name": track.name if track else None,
            "lane_count": track.lane_count if track else None,
            "timer_type": track.timer_type.value if track else None,
        },
        **mgr.test_report(),
    }
    filename = f"trusty-track-timer-report-track-{track_id}.json"
    return JSONResponse(
        report,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Mount static assets if the built frontend exists
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve dist files when they exist, otherwise fall back to index.html."""
        candidate = (FRONTEND_DIST / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(FRONTEND_DIST.resolve()):
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")


@app.websocket("/ws/timer/{track_id}")
async def timer_websocket(websocket: WebSocket, track_id: int):
    """WebSocket endpoint for frontend-proxy timer mode.

    Operator-only when a PIN is set (#15). This socket *is* the timer on a
    proxied track: whatever connects here reports the lane times that become the
    result of a heat. Left open it is the one path where someone on the venue
    wifi could change who won, without touching a mutation — the role policy in
    `api/auth.py` guards GraphQL and this is not GraphQL.

    The PIN arrives as a query parameter for the same reason it does on the
    subscription socket: a browser cannot set headers on a WebSocket handshake.
    """
    # The demo runs a fake timer and has no port for anything to proxy, so this
    # socket has nothing to do there — and with no PIN set it is open to
    # everyone. Closed with the role code: which of the two reasons applies is
    # not a caller's business.
    if demo_mode.enabled():
        await websocket.accept()
        await websocket.close(code=4403, reason="Operator PIN required")
        return

    # Credentials before anything else, so an unauthenticated caller learns
    # nothing — not whether the track exists, nor whether proxy mode is on.
    db = SessionLocal()
    try:
        role = _role_for_request(db, websocket.query_params.get("pin"))
    finally:
        db.close()
    if role is not auth.Role.OPERATOR:
        await websocket.accept()
        await websocket.close(code=4403, reason="Operator PIN required")
        return

    if track_id not in TIMER_MANAGERS:
        await websocket.accept()
        await websocket.close(code=4000, reason="Track not found")
        return

    manager = TIMER_MANAGERS[track_id]

    # Check database to ensure proxy mode is intended for this track
    db = SessionLocal()
    try:
        track = db.query(models.Track).filter(models.Track.id == track_id).first()
        chosen_profile = None
        if not track or track.timer_type != models.TimerType.AUTO_DETECT_PROXY:
            await websocket.accept()
            await websocket.close(
                code=4000, reason="Proxy mode not enabled for this track"
            )
            return
        if track.timer_profile:
            chosen_profile = devices.by_key(track.timer_profile)
    finally:
        db.close()

    await websocket.accept()

    # A second connection for this track takes over rather than sharing it
    # silently (#301). Popped rather than merely read, so the outgoing
    # connection's own `finally` — once its receive loop eventually notices
    # the close below — finds no entry naming it and skips tearing its
    # session down a second time; see TIMER_WS_CONNECTIONS above for why that
    # matters.
    previous = TIMER_WS_CONNECTIONS.pop(track_id, None)
    if previous is not None:
        prev_websocket, prev_session = previous
        logger.info(
            "Timer %d: a new proxy connection is taking over from an existing one",
            track_id,
        )
        await prev_session.close()
        with suppress(Exception):
            await prev_websocket.close(
                code=4000, reason="Another connection took over this timer"
            )

    # Everything ordered — asking for the port, walking the candidate profiles,
    # handing the identified device to the manager — is the session's. What is
    # left here is the message encoding, which is what this endpoint is for.
    transport = WebSocketTransport(websocket.send_json, track_id)
    manager.set_write_fn(transport.send)
    # A track whose model the operator named skips the walk entirely (#143).
    session = ProxySession(manager, transport, chosen=chosen_profile)
    TIMER_WS_CONNECTIONS[track_id] = (websocket, session)
    session.start()

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ready":
                session.on_ready()
            elif data.get("type") == "serial_rx":
                rx_bytes = base64.b64decode(data["data"])
                await session.on_bytes(rx_bytes)
            elif data.get("type") == "pong":
                # Heartbeat handled by FastAPI/Starlette usually, but we can log
                # if needed
                pass
    except WebSocketDisconnect:
        logger.info("Proxy WebSocket disconnected for track %d", track_id)
    except Exception as e:
        logger.error("WebSocket error for track %d: %s", track_id, e)
    finally:
        current = TIMER_WS_CONNECTIONS.get(track_id)
        if current is not None and current[0] is websocket:
            del TIMER_WS_CONNECTIONS[track_id]
            await session.close()


#: The largest upload this route accepts, in bytes.
#:
#: A phone photograph is a few megabytes and a HEIC burst can be more, so the
#: limit is generous rather than tight — what it exists to stop is a caller
#: naming their own size. Without it `file.read()` pulls an arbitrary body
#: straight into memory on a machine with a gigabyte of RAM.
MAX_UPLOAD_BYTES = 16 * 1024 * 1024

#: How much is read at a time while checking that limit.
_UPLOAD_CHUNK = 1024 * 1024

#: The extension stored for each format Pillow can report, mirroring the
#: allowlist ``uploadImage`` (schema.py) already enforces for its GraphQL
#: twin. `convert_to_browser_safe_png` re-encodes anything outside this set
#: to PNG, so a format reaching `_sniffed_extension` unconverted is already
#: guaranteed to be one of these four — the refusal below is defence in
#: depth, not a path either caller expects to take.
_EXTENSION_FOR_FORMAT = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "GIF": ".gif",
    "WEBP": ".webp",
}


def _sniffed_extension(image_bytes: bytes) -> str:
    """Return the extension for *image_bytes*, derived from the bytes
    themselves rather than from a filename or a client-supplied content type.

    A caller naming their upload ``x.html`` on a valid small GIF must not get
    an ``.html`` back — that file is then served from `/static` as HTML on
    the app's own origin (issue #322).
    """
    fmt = Image.open(io.BytesIO(image_bytes)).format
    ext = _EXTENSION_FOR_FORMAT.get(fmt) if fmt else None
    if ext is None:
        raise HTTPException(status_code=400, detail=f"Unsupported image format: {fmt}")
    return ext


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """Read *file* up to *limit* bytes, refusing anything larger.

    Chunked rather than `await file.read()` and a length check afterwards: the
    check would happen once the whole body was already in memory, which is the
    thing being guarded against.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_UPLOAD_CHUNK):
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/upload/")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Upload a file and return its static URL.

    Guarded for itself, like the backup routes and the timer socket: the role
    policy covers GraphQL mutations and this is not one (#15). At ``CHECKIN``
    rather than ``OPERATOR`` because its GraphQL twin ``uploadImage`` is a
    check-in mutation, and photographing a car is the desk's job.

    Nothing in the frontend calls this — images go through ``uploadImage`` as a
    data URL — but it is a documented endpoint (`docs/design.md` §3.3) and it
    wrote a permanent file from an unauthenticated request until this check
    existed. The suite's data directory reached 8,000 files and 3.5 GB before
    anybody looked at what nothing was deleting; see `tests/conftest.py`.
    """
    _refuse_on_demo("Uploading images")
    _require_checkin(request, db)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    raw_bytes = await _read_capped(file, MAX_UPLOAD_BYTES)
    image_bytes = convert_to_browser_safe_png(raw_bytes)

    # The stored extension comes from the sniffed image content, never from
    # the caller-supplied filename (#322) — a filename claiming `.html` on a
    # small, browser-native GIF/JPEG polyglot must not end up served as HTML
    # from this app's own origin.
    ext = ".png" if image_bytes is not raw_bytes else _sniffed_extension(image_bytes)

    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        buffer.write(image_bytes)

    return {"url": f"/static/{filename}"}
