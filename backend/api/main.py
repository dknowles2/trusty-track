"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import base64
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from strawberry.fastapi import GraphQLRouter

from backend.api import auth
from backend.api.loaders import RequestLoaders
from backend.api.schema import schema
from backend.db import models
from backend.db.database import UPLOAD_DIR, SessionLocal, init_db
from backend.services import printables
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
        logger.error(f"Failed to initialize database: {e}")
        # In a real production app, you might want to exit here

    logger.info("Initializing timer managers...")
    try:
        await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)
        logger.info("Timer managers ready: %s", list(TIMER_MANAGERS.keys()))
    except Exception as e:
        logger.error(f"Failed to initialize timer managers: {e}")

    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # `allow_origins=["*"]` with `allow_credentials=True` is rejected outright
    # by browsers — the wildcard is not permitted on a credentialed request — so
    # the old pairing was broken *and* permissive (#15). Nothing here uses
    # cookies: the operator PIN travels in a header on a same-origin request, so
    # credentials are off and the wildcard is honest. A display or a phone on
    # the venue wifi loads the served page from this origin; a wildcard here
    # does not widen what they can do, because the PIN is what the server checks.
    allow_origins=["*"],
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

    return {
        "db": db,
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
    """WebSocket endpoint for frontend-proxy timer mode."""
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

    # Everything ordered — asking for the port, walking the candidate profiles,
    # handing the identified device to the manager — is the session's. What is
    # left here is the message encoding, which is what this endpoint is for.
    transport = WebSocketTransport(websocket.send_json, track_id)
    manager.set_write_fn(transport.send)
    # A track whose model the operator named skips the walk entirely (#143).
    session = ProxySession(manager, transport, chosen=chosen_profile)
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
        await session.close()


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a file and return its static URL."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    raw_bytes = await file.read()
    image_bytes = convert_to_browser_safe_png(raw_bytes)

    # Use .png extension if conversion happened, otherwise keep original.
    ext = ".png" if image_bytes is not raw_bytes else os.path.splitext(file.filename)[1]

    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        buffer.write(image_bytes)

    return {"url": f"/static/{filename}"}
