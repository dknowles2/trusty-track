import os

import pytest

# Set this before importing any backend modules to ensure they use the test directory
os.environ["TRUSTYTRACK_DATA_DIR"] = "/tmp/trustytrack_test"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.main import app, get_db
from backend.db import crud, schemas
from backend.db.database import Base
from backend.db.lane_sync import lanes_out_of_sync

# Use in-memory SQLite database
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session")
def engine():
    return create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture(scope="function")
def db_session(engine):
    """
    Creates a fresh database schema for each test function over the same
    in-memory engine, destroys it afterwards.
    """
    Base.metadata.create_all(bind=engine)
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = testing_session_local()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function", autouse=True)
def heat_lanes_stay_in_sync(db_session):
    """Assert `heat_lanes` still matches the blobs at the end of every test.

    Issue #5, step two. The projection in `db/lane_sync.py` has to hold for
    every path that writes a blob, and there are more of those than anyone can
    enumerate — eight or so in `crud.py`, plus the free-race helpers, plus
    `TimerManager` writing from outside the request lifecycle.

    Rather than trying to list them, this makes the whole existing suite the
    test: scheduling, advancement, result recording, racer deletion, free race
    and the timer are all already covered, so a write site that forgets to go
    through the ORM fails here instead of silently rotting the table.
    """
    yield
    # Anything a test left pending is a change the listener has not seen yet;
    # flushing it is what a request or a commit would have done anyway.
    db_session.flush()
    problems = lanes_out_of_sync(db_session)
    assert not problems, "heat_lanes drifted from lane_results:\n" + "\n".join(problems)


@pytest.fixture(scope="function", autouse=True)
def override_get_db(db_session):
    """
    Automatically overrides the 'get_db' dependency for all tests.
    """

    def _get_db_override():
        try:
            yield db_session
        finally:
            # We don't close here because db_session fixture handles it
            pass

    app.dependency_overrides[get_db] = _get_db_override
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="function", autouse=True)
def timer_session_factory(db_session, monkeypatch):
    """Point TimerManager's result recording at the test database.

    TimerManager records from a background task rather than a request, so it
    takes a session factory instead of importing one. Handing it the test
    session keeps the whole suite on a single in-memory database — previously
    these writes went to a separate, file-backed database that had to be
    created up front by its own session-scoped fixture.

    The returned session ignores close(): the db_session fixture owns its
    lifetime, and the manager closes the session it is handed.
    """

    class _NonClosingSession:
        def __getattr__(self, name):
            return getattr(db_session, name)

        def close(self):
            pass

    factory = _NonClosingSession

    # Covers managers built with the default factory...
    monkeypatch.setattr("backend.services.timer.manager.SessionLocal", factory)
    # ...and those built mid-request, which take it from the GraphQL context.
    monkeypatch.setattr("backend.api.main.SessionLocal", factory)
    return factory


@pytest.fixture(scope="function")
def db(db_session):
    """Alias for db_session to support existing tests using 'db' argument."""
    return db_session


@pytest.fixture(scope="function")
def client(db_session):  # noqa: ARG001 - depended on for fixture ordering
    """
    Exposes a TestClient that can be used by tests.
    """
    return TestClient(app)


@pytest.fixture(scope="function")
def default_track(db):
    """
    Creates a default track for tests that require one.
    """
    track_in = schemas.TrackCreate(
        name="Default Track", lane_count=4, timer_type="FAKE"
    )
    track = crud.create_track(db, track_in)
    return track.id
