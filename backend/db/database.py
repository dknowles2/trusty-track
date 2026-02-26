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
