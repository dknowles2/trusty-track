import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)


@event.listens_for(Engine, "connect")
def _enforce_foreign_keys(dbapi_connection, _connection_record) -> None:
    """Turn on SQLite's foreign key enforcement for every connection (#125).

    SQLite defaults enforcement **off**, and the default is per *connection*
    rather than per database, so without this every ``ForeignKey`` in
    ``models.py`` is documentation: a heat naming a race that has been deleted,
    a lane naming a racer who has, a round on a race that never existed — all
    written without complaint.

    Registered on the ``Engine`` class rather than on this module's engine
    because this module's engine is not the only one. ``TimerManager`` writes
    through its own ``SessionLocal`` (#9), Alembic's CLI builds its own, and
    the test suite keeps a second file-backed database — attaching it to one
    engine leaves the others unenforced, which is a guarantee that holds
    everywhere except where it is being checked.

    Migrations suspend it for the duration of a run: batch mode rewrites a
    table by creating a new one, copying the rows and dropping the old, and the
    intermediate states of a rebuild are not meant to be consistent. See
    ``migrations/env.py``.
    """
    # Non-SQLite backends enforce by default and have no such pragma.
    if type(dbapi_connection).__module__.split(".")[0] not in ("sqlite3", "pysqlite3"):
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


# Load environment variables from .env if present
load_dotenv()

# Configurable data directory
DATA_DIR = os.path.expanduser(os.getenv("TRUSTYTRACK_DATA_DIR", "~/.trustytrack"))
os.makedirs(DATA_DIR, exist_ok=True)

# Configurable uploads directory
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Configurable database URL
DEFAULT_DB_URL = f"sqlite:///{os.path.join(DATA_DIR, 'trusty-track.db')}"
SQLALCHEMY_DATABASE_URL = os.getenv("TRUSTYTRACK_DB_URL", DEFAULT_DB_URL)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Revision that the pre-Alembic schema corresponds to. Databases created before
# migrations existed are stamped here and then upgraded forward.
LEGACY_BASELINE_REVISION = "0001_baseline"


def _migrations_dir() -> Path:
    """Locate the bundled migrations directory.

    Works both from a source checkout and from inside a PyInstaller bundle,
    where data files are unpacked under ``sys._MEIPASS``.
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "backend" / "migrations"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent.parent / "migrations"


def _alembic_config():
    """Build an Alembic config in code, so no alembic.ini is needed at runtime."""
    from alembic.config import Config

    migrations = _migrations_dir()
    if not migrations.is_dir():
        raise RuntimeError(
            f"Database migrations directory not found at {migrations}. "
            "The installation is incomplete; refusing to start rather than "
            "risk running against an unmigrated database."
        )

    config = Config()
    config.set_main_option("script_location", str(migrations))
    config.set_main_option("sqlalchemy.url", SQLALCHEMY_DATABASE_URL)
    # env.py reconfigures logging from alembic.ini when run via the CLI; the
    # application owns its own logging setup, so tell it not to.
    config.attributes["skip_logging_config"] = True
    return config


def _is_legacy_database(connection) -> bool:
    """True if this database has our tables but is not under Alembic control.

    Deliberately tests for a recorded *revision*, not for the presence of the
    ``alembic_version`` table. Alembic creates that table empty as soon as
    anything reads the version — a bare ``alembic check`` is enough — so a
    database can have the table with no row in it. Treating that as "already
    managed" skips the stamp and then tries to run the baseline migration
    against tables that already exist, which fails with
    "table groups already exists" and takes the app down at startup.
    """
    from alembic.runtime.migration import MigrationContext

    if MigrationContext.configure(connection).get_current_revision() is not None:
        return False
    # "groups" is in the very first schema this app ever shipped.
    return "groups" in set(inspect(connection).get_table_names())


def init_db() -> None:
    """Bring the database schema up to date.

    Replaces the old ``create_all()`` plus hand-rolled ``ALTER TABLE``. Unlike
    that approach, this actually migrates existing databases, and it raises
    rather than swallowing failures — a half-migrated database that appears to
    start normally is worse than a clear refusal to start.
    """
    from alembic import command
    from alembic.runtime.migration import MigrationContext

    config = _alembic_config()

    with engine.begin() as connection:
        if _is_legacy_database(connection):
            logger.info(
                "Existing pre-Alembic database detected; stamping it at %s "
                "before upgrading.",
                LEGACY_BASELINE_REVISION,
            )
            config.attributes["connection"] = connection
            command.stamp(config, LEGACY_BASELINE_REVISION)

        config.attributes["connection"] = connection
        command.upgrade(config, "head")

        current = MigrationContext.configure(connection).get_current_revision()
        logger.info("Database schema is at revision %s", current)

    # Migrations suspend foreign key enforcement (see `migrations/env.py`), and
    # the restore does not stick: `PRAGMA foreign_keys` is a no-op inside a
    # transaction, and by the time the context manager exits the migration run
    # has opened one. The connection then goes back to the pool with
    # enforcement off, and every session handed out afterwards inherits it —
    # so the app would run with foreign keys silently disabled while the whole
    # test suite, which never calls `init_db`, reported them enforced.
    #
    # Dropping the pool is the fix rather than re-setting the pragma: the
    # listener already sets it correctly on connect, and this way there is one
    # place that decides. It costs one reconnect, once, at startup.
    engine.dispose()
