import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

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
    """True if this database predates Alembic: has our tables, but no version."""
    tables = set(inspect(connection).get_table_names())
    if "alembic_version" in tables:
        return False
    # "groups" is in the very first schema this app ever shipped.
    return "groups" in tables


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
