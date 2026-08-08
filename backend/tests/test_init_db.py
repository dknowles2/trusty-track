import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import inspect

# Import app after env var is set in conftest.py
from backend.api.main import app
from backend.db.database import DATA_DIR, engine

client = TestClient(app)


def test_the_suite_writes_to_a_temporary_data_directory():
    """The suite must not write into the operator's own data directory.

    `database.py` reads `TRUSTYTRACK_DATA_DIR` at import time and defaults to
    `~/.trustytrack`, so losing conftest's assignment — or importing the app
    before it — silently points the whole suite at a real install: this file
    would delete its database, and every upload test would drop an image beside
    the operator's photos. Nothing else in the tree would fail.
    """
    from backend.tests.conftest import TEST_DATA_DIR

    assert DATA_DIR == TEST_DATA_DIR
    assert DATA_DIR.startswith(tempfile.gettempdir())


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

    # Read from the module rather than repeating the path conftest chose. It
    # was hardcoded here, so moving the test data directory silently pointed
    # this test at one place and the app at another.
    db_path = Path(DATA_DIR) / "trusty-track.db"
    if db_path.exists():
        os.remove(db_path)

    # Ensure directory exists
    os.makedirs(DATA_DIR, exist_ok=True)

    # Use TestClient as context manager to trigger lifespan events
    with TestClient(app) as _:
        # Check if tables exist
        inspector = inspect(engine)
        tables = inspector.get_table_names()

        # Verify key tables are present
        assert "racers" in tables
        assert "races" in tables
        assert "tracks" in tables
