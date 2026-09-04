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

# Whether the data directory was explicitly chosen, rather than defaulted to
# ~/.trustytrack because nothing said otherwise. Read only by the Alembic CLI
# guard in migrations/env.py (#689) — a contributor who has set either of
# these has already made a deliberate choice about where migrations run, so
# there is nothing left for that guard to protect against.
DATA_DIR_EXPLICIT = bool(
    os.environ.get("TRUSTYTRACK_DATA_DIR") or os.environ.get("TRUSTYTRACK_DB_URL")
)

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


def database_path() -> Path | None:
    """The SQLite file this install writes to, or ``None`` if it is not a file.

    Every install is a single SQLite file in the data directory; this exists so
    the backup service (#176) can name it without re-parsing the URL, and
    returns ``None`` rather than guessing for an in-memory or non-SQLite URL,
    which is what the test suite sometimes points at.
    """
    prefix = "sqlite:///"
    if not SQLALCHEMY_DATABASE_URL.startswith(prefix):
        return None
    path = SQLALCHEMY_DATABASE_URL[len(prefix) :]
    if not path or path.startswith(":memory:"):
        return None
    return Path(path)


def database_holds_real_data() -> bool:
    """True if the target database already has a configured ``Organization``.

    Used only by the Alembic CLI guard in ``migrations/env.py`` (#689), never
    by ``init_db()`` itself — that call runs against the real data directory
    by design, every time the app starts. This is what tells an empty or
    not-yet-created install, the ordinary case for a contributor running
    ``alembic upgrade head`` for the first time, from a real event's database,
    which the CLI must not be allowed to touch by accident.
    """
    path = database_path()
    if path is None:
        return False
    return _sqlite_file_has_a_configured_organization(path)


def _sqlite_file_has_a_configured_organization(path: Path) -> bool:
    """The testable half of ``database_holds_real_data``, given a real path.

    An organization is created exactly once, by the first-run wizard — the
    same "does this install have one yet" question ``demo_content.is_seeded``
    already asks elsewhere — so its absence is a reliable signal that nothing
    here would be lost by a mistake, and its presence means there is a real
    race, and probably a folder of photographs of real children, on the other
    end of this file.

    A file that exists but cannot be read as SQLite (mid-write, corrupt, or
    simply not a database) resolves to ``True`` rather than ``False`` — a
    false "nothing to protect" is the wrong direction to be wrong in.
    """
    import sqlite3

    if not path.is_file():
        return False

    try:
        connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        return False
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='organizations'"
        )
        if cursor.fetchone() is None:
            return False
        cursor.execute("SELECT 1 FROM organizations LIMIT 1")
        return cursor.fetchone() is not None
    except sqlite3.DatabaseError:
        return True
    finally:
        connection.close()


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


def known_revisions() -> set[str]:
    """Every Alembic revision this install ships migrations for.

    Used by the backup restore (#176) to tell an older archive, which upgrades
    forward cleanly, from one taken by a newer Trusty Track, whose schema this
    version has no migrations for and no way back from.
    """
    from alembic.script import ScriptDirectory

    scripts = ScriptDirectory.from_config(_alembic_config())
    return {revision.revision for revision in scripts.walk_revisions()}


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
