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


def test_two_checkouts_do_not_share_a_data_directory():
    """Several worktrees of this repository are a normal way to work.

    Each has its own pytest and its own pre-commit hook, and they share one
    `TMPDIR` — so with one name between them, a commit in one worktree deleted
    the database and uploads of a run under way in another. It was quiet when
    it happened: nearly every test holds its database in memory and never
    looks at this directory, so what surfaced was an occasional inexplicable
    failure in the few that do.
    """
    from backend.tests.data_dir import data_dir_for

    assert data_dir_for("/home/dev/trusty-track", None) != data_dir_for(
        "/home/dev/trusty-track-2", None
    )


def test_each_worker_of_a_run_gets_its_own_data_directory():
    """The suite runs `-n auto`, and the workers are processes.

    They import `conftest.py` the same way, and the first thing it does with
    this directory is delete it.
    """
    from backend.tests.data_dir import data_dir_for

    checkout = "/home/dev/trusty-track"
    assert data_dir_for(checkout, "gw0") != data_dir_for(checkout, "gw1")
    # A run without xdist is named rather than left unsuffixed, so every
    # directory in TMPDIR reads the same way.
    assert data_dir_for(checkout, None).endswith("_main")
    assert data_dir_for(checkout, "") == data_dir_for(checkout, None)


def test_the_name_is_stable_for_one_checkout():
    """Not a pid or a timestamp, and that is what makes the wipe safe.

    A fixed name is what lets the directory be cleared at the *start* of a run
    rather than the end: a run that is killed still leaves a virgin directory
    for the next one, and the wreckage of a failed run stays put to be looked
    at. A unique name per run would instead leave a directory behind every
    time, which is the problem this whole arrangement exists to avoid.
    """
    from backend.tests.data_dir import data_dir_for

    assert data_dir_for("/home/dev/trusty-track", "gw0") == data_dir_for(
        "/home/dev/trusty-track", "gw0"
    )
    # And the checkout is read as a path, so the same one spelt two ways is
    # one directory rather than two.
    assert data_dir_for("/home/dev/trusty-track/", None) == data_dir_for(
        "/home/dev/trusty-track", None
    )


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
