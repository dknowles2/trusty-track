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
from backend.db.database import init_db as init_real_db

# Use in-memory SQLite database
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="session", autouse=True)
def _init_real_db_schema():
    """
    TimerManager persists heat results via backend.db.database.SessionLocal
    directly (it's a background service, not a per-request dependency), so it
    bypasses the get_db override below and writes to the real, file-backed
    test database. Create its schema once up front so those writes always
    land on a table that exists, regardless of test collection order.
    """
    init_real_db()


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
