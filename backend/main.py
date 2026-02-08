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
import json
from . import crud, models, schemas, scoring
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

@app.get("/races/{race_id}/dens/", response_model=List[schemas.Den])
def read_dens(race_id: int, skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return crud.get_dens(db, race_id=race_id, skip=skip, limit=limit)

@app.post("/races/{race_id}/dens/", response_model=schemas.Den)
def create_den(race_id: int, den: schemas.DenCreate, db: Session = Depends(get_db)):
    # Check if name exists in this race? Or just create. Unique constraint is removed, but we might want logical uniqueness.
    # For now, let's just create.
    existing = crud.get_den_by_name(db, den.name, race_id)
    if existing:
         raise HTTPException(status_code=400, detail="Den with this name already exists in this race")
    return crud.create_den(db=db, den=den, race_id=race_id)

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

@app.delete("/races/{race_id}")
def delete_race(race_id: int, db: Session = Depends(get_db)):
    success = crud.delete_race(db, race_id=race_id)
    if not success:
        raise HTTPException(status_code=404, detail="Race not found")
    return {"message": "Race deleted successfully"}

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
    if not file.filename or not file.filename.endswith('.csv'):
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
                den = crud.get_den_by_name(db, den_name, race_id)
                if den:
                    den_id = den.id
                else:
                    # Create new Den
                    random_color = "#{:06x}".format(random.randint(0, 0xFFFFFF))
                    new_den = schemas.DenCreate(name=den_name, color=random_color)
                    created_den = crud.create_den(db, new_den, race_id)
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

@app.post("/races/{race_id}/wizard", response_model=List[schemas.Round])
def create_race_wizard(race_id: int, config: schemas.WizardConfiguration, db: Session = Depends(get_db)):
    # 1. Verification: ensure race exists
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    
    # Check if rounds already exist - we only allow wizard if no rounds exist
    existing_rounds = crud.get_rounds(db, race_id)
    if existing_rounds:
        raise HTTPException(status_code=400, detail="Cannot use wizard: rounds already exist for this race.")

    created_rounds = []
    current_round_number = 1

    try:
        # 2. Create General Rounds
        if config.general_round.type == "PACK":
            # Single PACK round
            round_obj = crud.create_round(
                db, race_id, current_round_number, 
                models.SchedulingStrategy.PPC, "All Pack"
            )
            
            # Generate Heats (stacking if runs_per_lane > 1)
            for i in range(config.general_round.runs_per_lane):
                crud.generate_heats_for_round(db, round_obj.id, clear_existing=(i == 0))
                
            created_rounds.append(round_obj)
            current_round_number += 1
        
        elif config.general_round.type == "DEN":
            # Round per Den
            dens = crud.get_dens(db, race_id)
            for den in dens:
                # Check if den has racers
                racers = db.query(models.Racer).filter(models.Racer.den_id == den.id).all()
                if not racers:
                    continue
                    
                round_obj = crud.create_round(
                    db, race_id, current_round_number,
                    models.SchedulingStrategy.PPC, den.name
                )
                
                p_ids = [r.id for r in racers]
                # Generate Heats (stacking if runs_per_lane > 1)
                for i in range(config.general_round.runs_per_lane):
                    crud.generate_heats_for_round(db, round_obj.id, racer_ids=p_ids, clear_existing=(i == 0))
                
                created_rounds.append(round_obj)
                current_round_number += 1
    
        # 3. Create Championship Rounds
        for champ_cfg in config.championship_rounds:
            round_obj = crud.create_round(
                db, race_id, current_round_number,
                models.SchedulingStrategy.PPC, champ_cfg.name,
                advancement_source=champ_cfg.source,
                advancement_num_racers=champ_cfg.num_top_racers
            )
            
            # Calculate number of placeholders
            num_placeholders = champ_cfg.num_top_racers
            if champ_cfg.source == "DEN":
                den_count = db.query(models.Den).filter(models.Den.race_id == race_id).count()
                num_placeholders = champ_cfg.num_top_racers * den_count
    
            # Generate with placeholders (stacking if runs_per_lane > 1)
            for i in range(champ_cfg.runs_per_lane):
                crud.generate_heats_for_round(db, round_obj.id, num_placeholders=num_placeholders, clear_existing=(i == 0))
                
            created_rounds.append(round_obj)
            current_round_number += 1

    except ValueError as e:
        # Rollback or clean up? 
        # Since we are in a single transaction (implicitly via FastAPI dependency), raising HTTPException might rollback?
        # Actually explicit rollback might be safer if we committed anything partial.
        # But create_round commits? Yes crud.py usually commits.
        # So we likely have partial rounds created.
        # Ideally we should delete them.
        for r in created_rounds:
            crud.delete_round(db, r.id)
        
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    return created_rounds


# --- Advancement Endpoints ---

@app.get("/races/{race_id}/rounds/{round_id}/advancement_status", response_model=schemas.AdvancementStatus)
def get_round_advancement_status(race_id: int, round_id: int, db: Session = Depends(get_db)):
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise HTTPException(status_code=404, detail="Round not found")
    
    requires_advancement = round_obj.advancement_source is not None
    
    # Check if already advanced (no placeholders left)
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    already_advanced = True
    any_placeholder = False
    for heat in heats:
        if heat.lane_results:
            results = json.loads(heat.lane_results)
            for res in results:
                if res.get("racer_id") is not None and res.get("racer_id") < 0:
                    any_placeholder = True
                    already_advanced = False
                    break
        if not already_advanced:
            break
    
    if not any_placeholder and requires_advancement:
        # If no placeholders were even found, but it requires advancement, 
        # it might mean it was already advanced or it's empty.
        # Let's trust already_advanced logic.
        pass

    # Check if ready (previous rounds completed)
    # Get all rounds for this race, sorted by round_number
    all_rounds = db.query(models.Round).filter(models.Round.race_id == race_id).order_by(models.Round.round_number).all()
    
    is_ready = True
    for r in all_rounds:
        if r.round_number < round_obj.round_number:
            # Check if all heats in this previous round are completed
            previous_heats = db.query(models.Heat).filter(models.Heat.round_id == r.id).all()
            for ph in previous_heats:
                if not ph.lane_results:
                    is_ready = False
                    break
                results = json.loads(ph.lane_results)
                # Check if any lane result is missing a time/place (if not placeholder)
                for res in results:
                    if res.get("racer_id") is not None and res.get("racer_id") > 0:
                        if res.get("time") is None and res.get("place") is None:
                            is_ready = False
                            break
                if not is_ready:
                    break
        if not is_ready:
            break

    # Calculate advancing racers if ready/needed
    advancing_racers = []
    
    # Always fetch standings to provide overall results
    standings = scoring.get_leaderboard(db, race_id)
    
    # Determine advancement rules (current round OR next round)
    adv_source = round_obj.advancement_source
    adv_num = round_obj.advancement_num_racers
    
    if not requires_advancement:
        # If this round doesn't specify advancement (e.g. General Round), check if the NEXT round does
        next_round = db.query(models.Round).filter(
            models.Round.race_id == race_id,
            models.Round.round_number > round_obj.round_number,
            models.Round.advancement_source != None
        ).order_by(models.Round.round_number.asc()).first()
        
        if next_round:
            requires_advancement = True
            adv_source = next_round.advancement_source
            adv_num = next_round.advancement_num_racers

    winner_ids = set()
    if requires_advancement:
        winner_ids = set(scoring.get_advancing_racers(
            db, race_id, adv_source, adv_num
        ))
        
    for s_data in standings:
        # Create a copy of dict to modify
        r_data = s_data.copy()
        r_data["is_advancing"] = r_data["racer_id"] in winner_ids
        advancing_racers.append(schemas.AdvancementRacer(**r_data))

    return schemas.AdvancementStatus(
        is_ready=is_ready,
        requires_advancement=requires_advancement,
        already_advanced=already_advanced,
        advancing_racers=advancing_racers,
        source=adv_source,
        num_racers=adv_num
    )


@app.post("/races/{race_id}/rounds/{round_id}/advance")
def advance_to_round(race_id: int, round_id: int, db: Session = Depends(get_db)):
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise HTTPException(status_code=404, detail="Round not found")
    
    if not round_obj.advancement_source:
        raise HTTPException(status_code=400, detail="This round is not configured for automatic advancement.")
    
    # Get winners
    winner_ids = scoring.get_advancing_racers(
        db, race_id, round_obj.advancement_source, round_obj.advancement_num_racers
    )
    
    if not winner_ids:
        raise HTTPException(status_code=400, detail="No racers found to advance. Are previous rounds finished?")
    
    # Resolve placeholders
    crud.resolve_round_placeholders(db, round_id, winner_ids)
    
    return {"status": "success", "racers_advanced": len(winner_ids)}

@app.post("/races/{race_id}/auto_number")
def auto_number_racers(race_id: int, db: Session = Depends(get_db)):
    count = crud.auto_number_racers(db, race_id)
    return {"message": f"Auto-numbered {count} racers", "updated_count": count}

# Round endpoints
@app.get("/races/{race_id}/rounds", response_model=List[schemas.Round])
def get_rounds(race_id: int, db: Session = Depends(get_db)):
    return crud.get_rounds(db, race_id)

@app.post("/races/{race_id}/rounds", response_model=List[schemas.Round])
def create_round(race_id: int, round_data: schemas.RoundCreate, db: Session = Depends(get_db)):
    # 1. Verification: ensure race exists
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
        
    created_rounds = []
    existing_rounds = crud.get_rounds(db, race_id)
    next_round_number = len(existing_rounds) + 1
    
    try:
        # 2. Case: Championship Round
        if round_data.advancement_source:
            # Check if any general rounds exist
            general_exists = db.query(models.Round).filter(
                models.Round.race_id == race_id,
                models.Round.advancement_source == None
            ).first() is not None
            
            if not general_exists:
                raise ValueError("Cannot add championship round: no general rounds exist yet. Schedule at least one general round first.")

            round_obj = crud.create_round(
                db, race_id, next_round_number, 
                round_data.scheduling_strategy, round_data.name,
                advancement_source=round_data.advancement_source,
                advancement_num_racers=round_data.advancement_num_racers
            )
            # Calculate placeholders
            num_placeholders = round_data.advancement_num_racers or 0
            if round_data.advancement_source == "DEN":
                den_count = db.query(models.Den).filter(models.Den.race_id == race_id).count()
                num_placeholders = (round_data.advancement_num_racers or 0) * den_count
                
            # Generate Heats with runs_per_lane
            for i in range(round_data.runs_per_lane):
                crud.generate_heats_for_round(db, round_obj.id, num_placeholders=num_placeholders, clear_existing=(i == 0))
                
            created_rounds.append(round_obj)
            
        # 3. Case: General Round (DEN)
        elif round_data.general_type == "DEN":
            dens = crud.get_dens(db, race_id)
            for den in dens:
                racer_ids = [r.id for r in db.query(models.Racer).filter(models.Racer.den_id == den.id).all()]
                if not racer_ids:
                    continue
                    
                round_obj = crud.create_round(
                    db, race_id, next_round_number,
                    round_data.scheduling_strategy, f"{den.name} - {round_data.name}" if round_data.name else den.name
                )
                
                # Generate Heats with runs_per_lane
                for i in range(round_data.runs_per_lane):
                    crud.generate_heats_for_round(db, round_obj.id, racer_ids=racer_ids, clear_existing=(i == 0))
                
                created_rounds.append(round_obj)
                next_round_number += 1
                
        # 4. Case: General Round (PACK)
        else:
            round_obj = crud.create_round(
                db, race_id, next_round_number,
                round_data.scheduling_strategy, round_data.name or "All Pack"
            )
            
            # Generate Heats with runs_per_lane
            for i in range(round_data.runs_per_lane):
                crud.generate_heats_for_round(db, round_obj.id, clear_existing=(i == 0))
                
            created_rounds.append(round_obj)
            
        return created_rounds
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/rounds/{round_id}", response_model=schemas.Round)
def update_round(round_id: int, round_update: schemas.RoundUpdate, db: Session = Depends(get_db)):
    db_round = crud.update_round(db, round_id, round_update)
    if not db_round:
        raise HTTPException(status_code=404, detail="Round not found")
    return db_round

@app.post("/rounds/{round_id}/generate_heats", response_model=List[schemas.Heat])
def generate_heats_for_round(round_id: int, db: Session = Depends(get_db)):
    try:
        return crud.generate_heats_for_round(db, round_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/rounds/{round_id}")
def delete_round(round_id: int, db: Session = Depends(get_db)):
    try:
        success = crud.delete_round(db, round_id)
        if not success:
            raise HTTPException(status_code=404, detail="Round not found")
        return {"message": "Round deleted"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/races/{race_id}/heats", response_model=List[schemas.Heat])
def get_heats(race_id: int, db: Session = Depends(get_db)):
    return crud.get_heats(db, race_id)

@app.put("/heats/reorder", response_model=schemas.HeatReorderResponse)
def reorder_heats(request: schemas.HeatReorderRequest, db: Session = Depends(get_db)):
    """
    Reorder heats within a round.
    
    All heats must belong to the same round.
    """
    heat_updates = [
        {"heat_id": item.heat_id, "new_heat_number": item.new_heat_number}
        for item in request.heat_updates
    ]
    
    updated_heats = crud.reorder_heats(db, heat_updates)
    
    return schemas.HeatReorderResponse(
        updated_count=len(updated_heats),
        heats=updated_heats
    )

@app.put("/heats/{heat_id}", response_model=schemas.Heat)
def update_heat(heat_id: int, heat: schemas.HeatCreate, db: Session = Depends(get_db)):
    # Check if we are resetting a previously completed heat
    existing_heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    is_resetting = False
    if existing_heat and existing_heat.lane_results:
        try:
            old_results = json.loads(existing_heat.lane_results)
            old_complete = any(r.get('time') is not None for r in old_results)
            
            # Check new results
            new_results = json.loads(heat.lane_results)
            new_complete = any(r.get('time') is not None for r in new_results)
            
            if old_complete and not new_complete:
                is_resetting = True
        except Exception:
            pass

    db_heat = crud.update_heat(db, heat_id=heat_id, heat=heat)
    if db_heat is None:
        raise HTTPException(status_code=404, detail="Heat not found")
    
    if is_resetting:
        # If this was the last heat of a General Round, we need to revert the Championship Round
        try:
            # Check if last heat
            round_heats = db.query(models.Heat).filter(models.Heat.round_id == db_heat.round_id).all()
            if round_heats:
                max_heat_num = max(h.heat_number for h in round_heats)
                if db_heat.heat_number == max_heat_num:
                    # Check if General Round (no advancement source set on the round itself)
                    round_obj = db.query(models.Round).filter(models.Round.id == db_heat.round_id).first()
                    if round_obj and not round_obj.advancement_source:
                        # Find next round that Might have been populated
                        next_round = db.query(models.Round).filter(
                             models.Round.race_id == db_heat.race_id,
                             models.Round.round_number > round_obj.round_number,
                             models.Round.advancement_source != None
                        ).order_by(models.Round.round_number.asc()).first()
                        
                        if next_round:
                            print(f"Heat reset detected on last heat of round {round_obj.id}. Reverting round {next_round.id}...")
                            crud.revert_round_to_placeholders(db, next_round.id)
        except Exception as e:
            print(f"Error handling heat reset logic: {e}")

    # Check for automatic advancement (forward direction)
    try:
        _check_and_advance_championship(db, db_heat.race_id)
    except Exception as e:
        # Log error but don't fail the heat update request
        print(f"Auto-advancement error: {e}")
        
    return db_heat



def _is_round_complete(db: Session, round_id: int) -> bool:
    """Check if a round is complete (all heats have results)."""
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    if not heats:
        return False
        
    for heat in heats:
        if not heat.lane_results:
            return False
        try:
            results = json.loads(heat.lane_results)
            for r in results:
                if r.get("racer_id") is not None and r.get("time") is None:
                    return False
        except:
            return False
    return True

def _check_and_advance_championship(db: Session, race_id: int):
    """
    Check if all general rounds are complete and trigger championship population if needed.
    """
    # 1. Identify General Rounds (advancement_source is NULL)
    gen_rounds = db.query(models.Round).filter(
        models.Round.race_id == race_id,
        models.Round.advancement_source == None
    ).all()
    
    if not gen_rounds:
        return
        
    # 2. Check if ALL heats in these rounds are complete
    for r in gen_rounds:
        if not _is_round_complete(db, r.id):
            return

    # 3. Process Championship Rounds
    champ_rounds = db.query(models.Round).filter(
        models.Round.race_id == race_id,
        models.Round.advancement_source != None
    ).order_by(models.Round.round_number).all()
    
    for round_obj in champ_rounds:
        # Check if already started (has ANY results with times)
        champ_heats = db.query(models.Heat).filter(
            models.Heat.round_id == round_obj.id
        ).all()
        
        round_started = False
        for heat in champ_heats:
            if heat.lane_results:
                try:
                    results = json.loads(heat.lane_results)
                    for r in results:
                        if r.get("time") is not None:
                            round_started = True
                            break
                except:
                    pass
            if round_started:
                break
        
        if round_started:
            continue  # Skip already started rounds
            
        # Check if PREVIOUS round is complete
        prev_round = db.query(models.Round).filter(
            models.Round.race_id == race_id,
            models.Round.round_number < round_obj.round_number
        ).order_by(models.Round.round_number.desc()).first()
        
        if prev_round and not _is_round_complete(db, prev_round.id):
            continue # Previous round not complete, wait.
            
        # Calculate winners
        winner_ids = scoring.get_advancing_racers(
            db, race_id, round_obj.advancement_source, round_obj.advancement_num_racers
        )
        
        if not winner_ids:
            continue
            
        # Re-generate heats with actual racers
        try:
            crud.generate_heats_for_round(
                db, round_obj.id, racer_ids=winner_ids, clear_existing=True
            )
        except Exception as e:
            print(f"Failed to populate round {round_obj.id}: {e}")

@app.get("/races/{race_id}/scores")
def get_race_scores(race_id: int, db: Session = Depends(get_db)):
    """Get current scores/leaderboard for a race."""
    race = crud.get_race(db, race_id)
    if not race:
        raise HTTPException(status_code=404, detail="Race not found")
    
    leaderboard = scoring.get_leaderboard(db, race_id)
    return {
        "race_id": race_id,
        "scoring_strategy": race.scoring_strategy.value,
        "leaderboard": leaderboard
    }

@app.get("/")
def read_root():
    return {"Hello": "World"}
