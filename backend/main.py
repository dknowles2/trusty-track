"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import os
import shutil
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from strawberry.fastapi import GraphQLRouter

import logging
from contextlib import asynccontextmanager

from typing import Dict

from . import models
from .database import DATA_DIR, SessionLocal, engine
from .schema import schema
from .timer.manager import TimerManager
from .timer.devices.fake import FakeTimerDevice
from .timer.devices.microwizard import MicroWizardDevice

# Registry of TimerManager instances, keyed by track_id
TIMER_MANAGERS: Dict[int, TimerManager] = {}

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _build_timer_managers() -> None:
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
            TIMER_MANAGERS[track.id] = TimerManager(track.id, device)
            logger.info(
                "TimerManager created for track %d (%s) with device %s",
                track.id, track.name, device.name,
            )
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
        _build_timer_managers()
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


# Create uploads directory if not exists
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")


async def get_graphql_context(db: Session = Depends(get_db)) -> dict:
    """Provide the database session and timer managers as GraphQL context."""
    return {"db": db, "timer_managers": TIMER_MANAGERS}


graphql_app = GraphQLRouter(schema, context_getter=get_graphql_context)
app.include_router(graphql_app, prefix="/graphql")


@app.get("/health")
async def health() -> dict:
    """Return application health status."""
    return {"status": "ok"}


# Mount static assets if the built frontend exists
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve index.html for all unknown paths (React Router)."""
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a file and return its static URL."""
    # Create unique filename
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    file_extension = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"/static/{filename}"}
