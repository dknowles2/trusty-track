from typing import List
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from . import crud, models, schemas
from .database import SessionLocal, engine

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/groups/", response_model=schemas.Group)
def create_group(group: schemas.GroupCreate, db: Session = Depends(get_db)):
    db_group = crud.get_group_by_name(db, name=group.name)
    if db_group:
        raise HTTPException(status_code=400, detail="Group already registered")
    return crud.create_group(db=db, group=group)

@app.get("/groups/{group_id}", response_model=schemas.Group)
def read_group(group_id: int, db: Session = Depends(get_db)):
    db_group = crud.get_group(db, group_id=group_id)
    if db_group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return db_group

@app.post("/races/", response_model=schemas.Race)
def create_race(race: schemas.RaceCreate, db: Session = Depends(get_db)):
    return crud.create_race(db=db, race=race)

@app.get("/races/", response_model=List[schemas.Race])
def read_races(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    races = crud.get_races(db, skip=skip, limit=limit)
    return races

@app.get("/")
def read_root():
    return {"Hello": "World"}
