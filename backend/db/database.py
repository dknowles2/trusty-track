import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

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


def init_db() -> None:
    """Initialize the database by creating all tables."""
    Base.metadata.create_all(bind=engine)

    # Migrate older databases to include new columns
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            # Check if debug_mode exists in groups table
            if engine.driver == "pysqlite" or "sqlite" in engine.url.drivername:
                res = conn.execute(text("PRAGMA table_info(groups)")).fetchall()
                columns = [r[1] for r in res]
                if columns and "debug_mode" not in columns:
                    conn.execute(
                        text(
                            "ALTER TABLE groups ADD COLUMN debug_mode BOOLEAN DEFAULT 0"
                        )
                    )
                    conn.commit()
            else:
                # Generic check for other DBs (Postgres, etc.)
                # This is more complex without Alembic, but we'll try basic approach.
                conn.execute(
                    text(
                        "ALTER TABLE groups ADD COLUMN IF NOT EXISTS "
                        "debug_mode BOOLEAN DEFAULT FALSE"
                    )
                )
                conn.commit()
        except Exception:
            # If groups table doesn't exist yet, metadata.create_all handled it.
            pass
