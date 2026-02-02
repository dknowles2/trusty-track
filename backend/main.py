from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
import os
import uuid
import shutil
import csv
import io
import random
from . import crud, models, schemas
from .database import SessionLocal, engine

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
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Create uploads directory if not exists
UPLOAD_DIR = "backend/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")

@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    # Create unique filename
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")
        
    file_extension = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"url": f"http://127.0.0.1:8000/static/{filename}"}

@app.post("/groups/", response_model=schemas.Group)
def create_group(group: schemas.GroupCreate, db: Session = Depends(get_db)):
    db_group = crud.get_group_by_name(db, name=group.name)
    if db_group:
        raise HTTPException(status_code=400, detail="Group already registered")
    return crud.create_group(db=db, group=group)

@app.get("/dens/", response_model=List[schemas.Den])
def read_dens(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_dens(db, skip=skip, limit=limit)

@app.post("/dens/", response_model=schemas.Den)
def create_den(den: schemas.DenCreate, db: Session = Depends(get_db)):
    return crud.create_den(db=db, den=den)

@app.delete("/dens/{den_id}")
def delete_den(den_id: int, db: Session = Depends(get_db)):
    db_den = crud.delete_den(db, den_id)
    if not db_den:
        raise HTTPException(status_code=404, detail="Den not found")
    return {"ok": True}

@app.put("/dens/{den_id}", response_model=schemas.Den)
def update_den(den_id: int, den_update: schemas.DenUpdate, db: Session = Depends(get_db)):
    db_den = crud.update_den(db, den_id, den_update)
    if not db_den:
        raise HTTPException(status_code=404, detail="Den not found")
    return db_den

@app.get("/groups/{group_id}", response_model=schemas.Group)
def read_group(group_id: int, db: Session = Depends(get_db)):
    db_group = crud.get_group(db, group_id=group_id)
    if db_group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return db_group

@app.post("/races/", response_model=schemas.Race)
def create_race(race: schemas.RaceCreate, db: Session = Depends(get_db)):
    return crud.create_race(db=db, race=race)

@app.get("/races/{race_id}", response_model=schemas.Race)
def read_race(race_id: int, db: Session = Depends(get_db)):
    db_race = crud.get_race(db, race_id=race_id)
    if not db_race:
        raise HTTPException(status_code=404, detail="Race not found")
    return db_race

@app.put("/races/{race_id}", response_model=schemas.Race)
def update_race(race_id: int, race_update: schemas.RaceUpdate, db: Session = Depends(get_db)):
    db_race = crud.update_race(db, race_id=race_id, race_update=race_update)
    if not db_race:
        raise HTTPException(status_code=404, detail="Race not found")
    return db_race

@app.get("/races/", response_model=List[schemas.Race])
def read_races(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    races = crud.get_races(db, skip=skip, limit=limit)
    return races

@app.get("/config/initial", response_model=schemas.InitialConfigStatus)
def get_initial_config_status(db: Session = Depends(get_db)):
    # Check if a group exists
    track = crud.get_track(db)
    if track:
        group = db.query(models.Group).first()
        race = db.query(models.Race).first()
        
        group_name = group.name if group else None
        current_race_id = race.id if race else None
        timer_type_val = track.timer_type.value if track.timer_type else None

        return schemas.InitialConfigStatus(
            initialized=True, 
            group_name=group_name,
            track_id=track.id,
            current_race_id=current_race_id,
            lane_count=track.lane_count,
            length_feet=track.length_feet,
            timer_type=timer_type_val
        )
    return schemas.InitialConfigStatus(initialized=False)

@app.post("/config/initial", response_model=schemas.InitialConfigStatus)
def create_initial_config(config: schemas.InitialConfigCreate, db: Session = Depends(get_db)):
    # Check if already initialized
    if crud.get_track(db):
        raise HTTPException(status_code=400, detail="System already initialized")
    
    group, track = crud.create_initial_config(db, config)
    return schemas.InitialConfigStatus(
        initialized=True,
        group_name=group.name,
        track_id=track.id
    )

@app.put("/config/initial", response_model=schemas.InitialConfigStatus)
def update_initial_config(config: schemas.InitialConfigCreate, db: Session = Depends(get_db)):
    track = crud.get_track(db)
    if not track:
        raise HTTPException(status_code=404, detail="System not initialized")
    
    group = db.query(models.Group).first()
    if group:
        if group.name != config.group_name:
            # Check if name is taken
            existing = crud.get_group_by_name(db, config.group_name)
            if existing:
                raise HTTPException(status_code=400, detail=f"Group '{config.group_name}' already exists")
            crud.update_group(db, group, config.group_name)
            
            # Refresh group after update to get new name
            db.refresh(group)
    
    track = crud.update_track(db, track, config)
    
    return schemas.InitialConfigStatus(
        initialized=True,
        group_name=group.name if group else None,
        track_id=track.id
    )

@app.get("/racers/", response_model=List[schemas.Racer])
def read_racers(skip: int = 0, limit: int = 100, race_id: Optional[int] = None, db: Session = Depends(get_db)):
    racers = crud.get_racers(db, skip=skip, limit=limit, race_id=race_id)
    return racers

@app.post("/racers/", response_model=schemas.Racer)
def create_racer(racer: schemas.RacerCreate, db: Session = Depends(get_db)):
    return crud.create_racer(db=db, racer=racer)

@app.put("/racers/{racer_id}", response_model=schemas.Racer)
def update_racer(racer_id: int, racer_update: schemas.RacerUpdate, db: Session = Depends(get_db)):
    db_racer = crud.update_racer(db, racer_id=racer_id, racer_update=racer_update)
    if db_racer is None:
        raise HTTPException(status_code=404, detail="Racer not found")
    return db_racer

@app.delete("/racers/{racer_id}")
def delete_racer(racer_id: int, db: Session = Depends(get_db)):
    db_racer = crud.delete_racer(db, racer_id=racer_id)
    if db_racer is None:
        raise HTTPException(status_code=404, detail="Racer not found")
    return {"ok": True}

@app.post("/races/{race_id}/populate")
def populate_race(race_id: int, count: int = 20, db: Session = Depends(get_db)):
    from . import populate
    populate.generate_fake_racers(db, race_id, count)
    return {"message": f"Populated race {race_id} with {count} racers"}

@app.post("/races/{race_id}/import-racers")
async def import_racers_csv(race_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a CSV file.")

    content = await file.read()
    decoded_content = content.decode('utf-8')
    csv_reader = csv.DictReader(io.StringIO(decoded_content))
    
    # Expected headers: First Name, Last Name, Car Number, Den
    # Normalize headers just in case
    
    added_count = 0
    errors = []
    
    for row_idx, row in enumerate(csv_reader):
        try:
            # Flexible key access (handle case sensitivity or extra spaces)
            row_clean = {k.strip().lower(): v.strip() for k, v in row.items() if k}
            
            first_name = row_clean.get("first name")
            last_name = row_clean.get("last name")
            
            if not first_name or not last_name:
                errors.append(f"Row {row_idx + 2}: Missing First Name or Last Name")
                continue
                
            car_number_str = row_clean.get("car number")
            car_number = int(car_number_str) if car_number_str and car_number_str.isdigit() else None
            
            den_name = row_clean.get("den")
            den_id = None
            if den_name:
                # Try to find den by name (case insensitive)
                den = crud.get_den_by_name(db, den_name)
                if den:
                    den_id = den.id
                else:
                    # Create new Den
                    random_color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
                    new_den = schemas.DenCreate(name=den_name, color=random_color)
                    created_den = crud.create_den(db, new_den)
                    den_id = created_den.id
            
            racer_Create = schemas.RacerCreate(
                first_name=first_name,
                last_name=last_name,
                car_number=car_number,
                den_id=den_id,
                race_id=race_id
            )
            
            crud.create_racer(db, racer_Create)
            added_count += 1
            
        except Exception as e:
            errors.append(f"Row {row_idx + 2}: {str(e)}")
            
    return {
        "message": f"Successfully imported {added_count} racers.",
        "errors": errors
    }

@app.post("/races/{race_id}/generate_heats", response_model=List[schemas.Heat])
def generate_schedule(race_id: int, db: Session = Depends(get_db)):
    return crud.generate_heats(db, race_id)

@app.get("/races/{race_id}/heats", response_model=List[schemas.Heat])
def get_heats(race_id: int, db: Session = Depends(get_db)):
    return crud.get_heats(db, race_id)

@app.put("/heats/{heat_id}", response_model=schemas.Heat)
def update_heat_result(heat_id: int, result: schemas.HeatBase, db: Session = Depends(get_db)):
    # result.lane_results should be the JSON string
    updated = crud.record_heat_result(db, heat_id, result.lane_results)
    if not updated:
        raise HTTPException(status_code=404, detail="Heat not found")
    return updated

@app.get("/")
def read_root():
    return {"Hello": "World"}
