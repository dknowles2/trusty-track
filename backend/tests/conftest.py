import os
import shutil

import pytest

from backend.tests.data_dir import data_dir_for

# Set this before importing any backend modules so they use the test directory:
# `database.py` reads it at import time and creates the uploads directory as a
# side effect, so anything importing the app first would already have pointed at
# the operator's own `~/.trustytrack`.
#
# The name separates the machine's temporary directory, this checkout and this
# xdist worker; `data_dir.py` holds why each part is there, and it is a module
# of its own so the rule can be tested without a suite that has already applied
# it. Worth knowing when you go looking for a failed run's database:
# `test_init_db.py` asserts the app agrees with what is set here.
#
# This assignment has to be the *only* statement before the imports below: ruff
# tolerates an `os.environ` write ahead of them (E402) and nothing else, which
# is why the wipe happens afterwards rather than here.
os.environ["TRUSTYTRACK_DATA_DIR"] = data_dir_for(
    os.path.dirname(os.path.abspath(__file__)),
    os.environ.get("PYTEST_XDIST_WORKER"),
)

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api.main import app, get_db
from backend.db import crud, schemas
from backend.db.database import DATA_DIR, UPLOAD_DIR, Base
from backend.services.timer import probe

#: Read back from the module rather than recomputed, so there is one answer to
#: "where does the suite write" and tests can assert against it.
TEST_DATA_DIR = DATA_DIR

# Wiped at the *start* of a run rather than the end. `POST /upload/` names each
# file after a fresh uuid and nothing ever removed them, so this directory grew
# by every image every run had ever written — 8,000 files and 3.5 GB before
# anybody looked. A run now leaves about 40 files behind.
#
# Up front rather than in teardown because a run that crashes or is killed still
# leaves a virgin directory for the next one, which teardown cannot promise; and
# because the artefacts of a failed run stay put to be looked at. Same trade the
# e2e config makes per invocation.
#
# The uploads directory is recreated immediately: `database.py` made it on
# import, `main.py` mounted it as static files, and removing it without putting
# it back would break every upload test.
#
# Two pytest runs *in the same checkout* at the same time still stand on each
# other: the name separates worktrees and workers, not two runs of the same
# one. That is the case a person can see — they started both — where the
# worktree case was invisible.
shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

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


# `heat_lanes_stay_in_sync` used to live here: an autouse fixture asserting
# `lanes_out_of_sync()` was empty after every test in the suite. It made the
# whole suite a test of the projection, and it is what validated every step
# from #119 to #129.
#
# It went with the blob (#72). There is one copy of a heat's lanes now, so
# there is nothing to compare it against — the check could only ever compare
# `heat_lanes` with itself. What replaces it is narrower and earlier:
# `test_heat_lanes_write.py` holds `crud.set_heat_lanes` as the only writer,
# across the whole backend package, so the paths this used to catch cannot be
# written in the first place.


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


@pytest.fixture(scope="function", autouse=True)
def no_real_serial_ports(monkeypatch):
    """The suite never touches hardware plugged into the machine running it.

    Timer auto-detection walks every USB serial port and *writes* a probe
    command to each one (#89). Left alone, a developer with any USB serial
    adapter attached — or a Pi running the tests with a timer on the bench —
    would have the suite talking to it, which is both a surprise and a way to
    make results depend on what happens to be plugged in.

    Both halves are stubbed: no ports are listed, and opening one raises even
    if a test supplies its own list. A test that exercises probing passes its
    own ``open_port`` to ``probe.detect`` rather than relying on either.
    """

    def refuse(port, profile):  # noqa: ARG001 - part of the PortOpener signature
        raise AssertionError(
            f"a test tried to open the real serial port {port!r}; "
            f"pass a fake opener to probe.detect instead"
        )

    monkeypatch.setattr(probe, "usb_ports", list)
    monkeypatch.setattr(probe, "open_serial", refuse)


@pytest.fixture(autouse=True)
def no_pre_probe_settle(monkeypatch):
    """The prober's settle is real time, and there is nothing here to settle.

    ``probe.PRE_PROBE_SETTLE_SECONDS`` is two seconds of `asyncio.sleep` before
    each candidate profile that asks for one, so a device that needs a moment
    after its pre-probe command has had it. Against the fake ports this suite
    uses there is nothing on the other end, and the wait is pure wall clock —
    paid once per candidate, so a walk of several profiles paid it several
    times over.

    Two tests were carrying seventeen of the suite's twenty-two seconds between
    them. It matters most where there are fewest workers to hide it: CI runs
    four, not ten. It is the settle that is stubbed rather than the sleep, so a
    test that wants to prove the wait happens can set it back.
    """
    monkeypatch.setattr(probe, "PRE_PROBE_SETTLE_SECONDS", 0.0)


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
