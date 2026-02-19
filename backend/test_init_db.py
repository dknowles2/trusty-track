import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from pathlib import Path

# Mock DATA_DIR for testing to avoid touching user's real DB
os.environ["TRUSTYTRACK_DATA_DIR"] = "/tmp/trustytrack_test"

# Import app after setting env var
from backend.main import app
from backend.database import engine, Base

client = TestClient(app)

def test_startup_creates_tables():
    # Clean up any existing test DB
    db_path = Path("/tmp/trustytrack_test/trusty-track.db")
    if db_path.exists():
        os.remove(db_path)
    
    # Ensure directory exists
    os.makedirs("/tmp/trustytrack_test", exist_ok=True)

    # Use TestClient as context manager to trigger lifespan events
    with TestClient(app) as _:
        # Check if tables exist
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        
        # Verify key tables are present
        assert "racers" in tables
        assert "races" in tables
        assert "tracks" in tables
