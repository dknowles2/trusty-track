"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import os
import shutil
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from strawberry.fastapi import GraphQLRouter

from . import models
from .database import DATA_DIR, SessionLocal, engine
from .schema import schema

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency
def get_db():
    """Yield a database session and ensure it's closed after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create uploads directory if not exists
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")


async def get_graphql_context(db: Session = Depends(get_db)) -> dict:
    """Provide the database session as GraphQL context."""
    return {"db": db}


graphql_app = GraphQLRouter(schema, context_getter=get_graphql_context)
app.include_router(graphql_app, prefix="/graphql")


@app.get("/health")
async def health() -> dict:
    """Return application health status."""
    return {"status": "ok"}


# Mount static assets if the built frontend exists
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve index.html for all unknown paths (React Router)."""
        index = FRONTEND_DIST / "index.html"
        return FileResponse(index)


@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a file and return its static URL."""
    # Create unique filename
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    file_extension = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {"url": f"/static/{filename}"}
