import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.main import app, get_db

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
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
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

@pytest.fixture(scope="module")
def client():
    """
    Exposes a TestClient that can be used by tests.
    Note: dependency_overrides are applied to 'app', so this client 
    will pick up the per-function overrides automatically.
    """
    return TestClient(app)
