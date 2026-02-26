"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import asyncio
import base64
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from strawberry.fastapi import GraphQLRouter

import pillow_heif

# Load environment variables from .env if present
load_dotenv()

from backend.db import models
from backend.db.database import SessionLocal, UPLOAD_DIR, engine
from backend.services.image_processing import convert_to_browser_safe_png
from backend.api.schema import schema
from backend.services.timer.manager import TimerManager
from backend.services.timer.devices.fake import FakeTimerDevice
from backend.services.timer.devices.microwizard import MicroWizardDevice

# Register the HEIF/HEIC plugin so Pillow can open those files.
pillow_heif.register_heif_opener()

# Registry of TimerManager instances, keyed by track_id
TIMER_MANAGERS: Dict[int, TimerManager] = {}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _build_timer_managers() -> None:
    """Query all Track records and create a TimerManager for each."""
    db = SessionLocal()
    try:
        tracks = db.query(models.Track).all()
        for track in tracks:
            if track.timer_type == models.TimerType.FAKE:
                device = FakeTimerDevice()
            else:
                # AUTO_DETECT_BACKEND / AUTO_DETECT_PROXY: use MicroWizard as the
                # target device; real connection logic is wired in Phase 2/3.
                device = MicroWizardDevice()
            
            manager = TimerManager(track.id, device)
            TIMER_MANAGERS[track.id] = manager
            logger.info(
                "TimerManager created for track %d (%s) with device %s",
                track.id, track.name, device.name,
            )

            # Start connection automatically if in direct-backend mode
            if track.timer_type == models.TimerType.AUTO_DETECT_BACKEND and track.serial_port:
                asyncio.create_task(manager.connect_direct(track.serial_port))
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle application lifespan events.
    Ensures the database is initialized before the app starts serving requests.
    """
    logger.info("Initializing database...")
    try:
        models.Base.metadata.create_all(bind=engine)
        logger.info("Database initialization complete.")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        # In a real production app, you might want to exit here

    logger.info("Initializing timer managers...")
    try:
        await _build_timer_managers()
        logger.info("Timer managers ready: %s", list(TIMER_MANAGERS.keys()))
    except Exception as e:
        logger.error(f"Failed to initialize timer managers: {e}")

    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
    _BASE_DIR = Path(__file__).parent.parent

FRONTEND_DIST = _BASE_DIR / "frontend" / "dist"

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")


async def get_graphql_context(db: Session = Depends(get_db)) -> dict:
    """Provide the database session and timer managers as GraphQL context."""
    return {"db": db, "timer_managers": TIMER_MANAGERS}


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
        if not track or track.timer_type != models.TimerType.AUTO_DETECT_PROXY:
            await websocket.accept()
            await websocket.close(code=4000, reason="Proxy mode not enabled for this track")
            return
    finally:
        db.close()

    await websocket.accept()

    # Define how to send bytes back to the frontend
    async def send_to_ws(data: bytes) -> None:
        try:
            await websocket.send_json({
                "type": "serial_tx",
                "data": base64.b64encode(data).decode("utf-8"),
            })
        except Exception as e:
            logger.error("Failed to send serial_tx to track %d: %s", track_id, e)

    # Tell the frontend to configure its serial port
    await websocket.send_json({
        "type": "configure",
        "baud_rate": manager._device.baud_rate,
    })

    manager.set_write_fn(send_to_ws)

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ready":
                await manager.handle_connect()
            elif data.get("type") == "serial_rx":
                rx_bytes = base64.b64decode(data["data"])
                await manager.receive_bytes(rx_bytes)
            elif data.get("type") == "pong":
                # Heartbeat handled by FastAPI/Starlette usually, but we can log if needed
                pass
    except WebSocketDisconnect:
        logger.info("Proxy WebSocket disconnected for track %d", track_id)
    except Exception as e:
        logger.error("WebSocket error for track %d: %s", track_id, e)
    finally:
        await manager.handle_disconnect()


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a file and return its static URL."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    raw_bytes = await file.read()
    image_bytes = convert_to_browser_safe_png(raw_bytes)

    # Use .png extension if conversion happened, otherwise keep original.
    if image_bytes is not raw_bytes:
        ext = ".png"
    else:
        ext = os.path.splitext(file.filename)[1]

    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        buffer.write(image_bytes)

    return {"url": f"/static/{filename}"}
