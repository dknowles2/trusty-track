from sqlalchemy.orm import Session
from . import models, schemas

def get_group(db: Session, group_id: int):
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_group_by_name(db: Session, name: str):
    return db.query(models.Group).filter(models.Group.name == name).first()

def create_group(db: Session, group: schemas.GroupCreate):
    db_group = models.Group(name=group.name)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

def get_races(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Race).offset(skip).limit(limit).all()

def create_race(db: Session, race: schemas.RaceCreate):
    race_data = race.dict()
    # Name is now required by schema, so no need to default it.
    
    db_race = models.Race(**race_data)
    db.add(db_race)
    db.commit()
    db.refresh(db_race)
    return db_race

def update_race(db: Session, race_id: int, race_update: schemas.RaceUpdate):
    db_race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not db_race:
        return None
    
    update_data = race_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_race, key, value)
        
    db.commit()
    db.refresh(db_race)
    return db_race

def get_race(db: Session, race_id: int):
    return db.query(models.Race).filter(models.Race.id == race_id).first()

def get_track(db: Session):
    # Assuming single track for now
    return db.query(models.Track).first()

def create_track(db: Session, track: schemas.TrackCreate):
    db_track = models.Track(**track.dict())
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track

def create_initial_config(db: Session, config: schemas.InitialConfigCreate):
    # Create Group
    group = models.Group(name=config.group_name)
    db.add(group)
    
    # Create Track
    track = models.Track(
        lane_count=config.lane_count,
        length_feet=config.length_feet,
        timer_type=config.timer_type
    )
    db.add(track)
    
    db.commit()
    db.refresh(group)
    db.refresh(track)
    return group, track

def update_group(db: Session, group: models.Group, name: str):
    group.name = name
    db.commit()
    db.refresh(group)
    return group

def update_track(db: Session, track: models.Track, config: schemas.InitialConfigCreate):
    track.lane_count = config.lane_count
    track.length_feet = config.length_feet
    track.timer_type = config.timer_type
    db.commit()
    db.refresh(track)
    return track

def get_racers(db: Session, skip: int = 0, limit: int = 100, race_id: int = None):
    query = db.query(models.Racer)
    if race_id:
        query = query.filter(models.Racer.race_id == race_id)
    return query.offset(skip).limit(limit).all()

def create_racer(db: Session, racer: schemas.RacerCreate):
    # Ensure a race exists.
    if racer.race_id:
        race = db.query(models.Race).filter(models.Race.id == racer.race_id).first()
    else:
        race = db.query(models.Race).first()
        
    if not race:
        group = db.query(models.Group).first()
        if not group:
            return None
        race = models.Race(name="Main Event", group_id=group.id)
        db.add(race)
        db.commit()
        db.refresh(race)

    racer_data = racer.dict()
    if 'race_id' in racer_data:
        del racer_data['race_id']
        
    rank = racer_data.pop("rank", None) # Remove rank from dict as it's not in Racer model

    # Handle Racing Group based on Rank
    if rank:
        # Find existing racing group for this rank in this race
        racing_group = db.query(models.RacingGroup).filter(
            models.RacingGroup.race_id == race.id,
            models.RacingGroup.rank == rank
        ).first()

        if not racing_group:
            # Create a new racing group for this rank
            # Format name nicely e.g. "Tigers" or just use the Rank value
            racing_group = models.RacingGroup(
                race_id=race.id,
                name=f"{rank.value}s", # e.g. BEARS, TIGERS
                rank=rank
            )
            db.add(racing_group)
            db.commit()
            db.refresh(racing_group)
        
        racer_data["racing_group_id"] = racing_group.id

    db_racer = models.Racer(**racer_data, race_id=race.id)
    db.add(db_racer)
    db.commit()
    db.refresh(db_racer)
    return db_racer

def update_racer(db: Session, racer_id: int, racer_update: schemas.RacerUpdate):
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if not db_racer:
        return None
    
    update_data = racer_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racer, key, value)
        
    db.commit()
    db.refresh(db_racer)
    return db_racer

def delete_racer(db: Session, racer_id: int):
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if db_racer:
        db.delete(db_racer)
        db.commit()
    return db_racer

def get_heats(db: Session, race_id: int):
    return db.query(models.Heat).filter(models.Heat.race_id == race_id).order_by(models.Heat.round_number, models.Heat.heat_number).all()

import json
from collections import deque

def generate_heats(db: Session, race_id: int):
    # 1. Get Race and Track Details
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return []
    
    # Assuming single track for now, getting the first one
    track = db.query(models.Track).first()
    lane_count = track.lane_count if track else 4

    # 2. Get Racers for this race
    # If we have racing groups, we might want to schedule them separately or together.
    # For now, let's schedule ALL racers in the race together (Interleaved) or just grab all.
    racers = db.query(models.Racer).filter(models.Racer.race_id == race_id).all()
    if not racers:
        return []
    
    # Clear existing heats?
    db.query(models.Heat).filter(models.Heat.race_id == race_id).delete()
    db.commit()

    # 3. Simple Lane Rotation Algorithm
    # Goal: Run every car in every lane once.
    # Rounds = Lane Count
    
    # We will rotate the list of racers 
    racer_ids = [r.id for r in racers]
    # If not enough racers to fill lanes, we just have empty lanes.
    # If more racers than lanes, we chunk them.
    
    generated_heats = []
    
    # Use a copy we can rotate
    current_order = deque(racer_ids)
    
    for round_num in range(1, lane_count + 1):
        # Create heats for this round by chunking the current order
        # We need to cover all racers.
        
        # Chunking
        for i in range(0, len(current_order), lane_count):
            heat_racers = list(current_order)[i : i + lane_count]
            
            # Map to lanes
            lane_assignment = []
            for lane_idx, r_id in enumerate(heat_racers):
                lane_assignment.append({
                    "lane": lane_idx + 1,
                    "racer_id": r_id,
                    "time": None,
                    "place": None
                })
            
            # Fill empty lanes if needed (optional, just omitting them is fine)
            
            heat = models.Heat(
                race_id=race_id,
                round_number=round_num,
                heat_number=len(generated_heats) + 1, # sequential global heat number
                lane_results=json.dumps(lane_assignment)
            )
            db.add(heat)
            generated_heats.append(heat)
            
        # Rotate for next round
        # Rotate by 1 ensures shifting.
        current_order.rotate(1)
        
    db.commit()
    return get_heats(db, race_id)

def record_heat_result(db: Session, heat_id: int, results: str):
    # results is a JSON string or we can take a dict
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat:
        heat.lane_results = results
        db.commit()
        db.refresh(heat)
    return heat
