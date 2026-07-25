import os
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import inspect

# Import app after env var is set in conftest.py
from backend.api.main import app
from backend.db.database import engine

client = TestClient(app)


def test_startup_creates_tables():
    """Exercise the real startup path against the real, file-backed database.

    This is the one test that deliberately touches the file database in
    TRUSTYTRACK_DATA_DIR; everything else runs on the in-memory session. Don't
    add a session-scoped fixture to pre-create that schema — TimerManager now
    takes an injected session factory, so nothing else needs the file database
    to exist.
    """
    # Dispose pooled connections before touching the file so none of them
    # are left referencing the file we're about to delete out from under them.
    engine.dispose()

    # Clean up any existing test DB
    db_path = Path("/tmp/trustytrack_test/trusty-track.db")
    if db_path.exists():
        os.remove(db_path)

    # Ensure directory exists
    os.makedirs("/tmp/trustytrack_test", exist_ok=True)

    # Use TestClient as context manager to trigger lifespan events
    with TestClient(app) as _:
        # Check if tables exist
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        # Verify key tables are present
        assert "racers" in tables
        assert "races" in tables
        assert "tracks" in tables
