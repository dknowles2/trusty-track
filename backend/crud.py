from typing import List, Any
import json
from collections import deque
from sqlalchemy.orm import Session
from . import models, schemas

def get_group(db: Session, group_id: int) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.id == group_id).first()

def get_group_by_name(db: Session, name: str) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.name == name).first()

def create_group(db: Session, group: schemas.GroupCreate) -> models.Group:
    db_group = models.Group(name=group.name)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group

def get_dens(db: Session, skip: int = 0, limit: int = 100) -> List[models.Den]:
    return db.query(models.Den).offset(skip).limit(limit).all()

def get_den(db: Session, den_id: int) -> models.Den | None:
    return db.query(models.Den).filter(models.Den.id == den_id).first()

def create_den(db: Session, den: schemas.DenCreate) -> models.Den:
    db_den = models.Den(**den.model_dump())
    db.add(db_den)
    db.commit()
    db.refresh(db_den)
    return db_den

def delete_den(db: Session, den_id: int) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if db_den:
        racers = db.query(models.Racer).filter(models.Racer.den_id == den_id).all()
        for racer in racers:
            racer.den_id = None
        
        db.delete(db_den)
        db.commit()
    return db_den

def update_den(db: Session, den_id: int, den_update: schemas.DenUpdate) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if not db_den:
        return None
    
    update_data = den_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_den, key, value)
        
    db.commit()
    db.refresh(db_den)
    return db_den

def get_races(db: Session, skip: int = 0, limit: int = 100) -> List[models.Race]:
    return db.query(models.Race).offset(skip).limit(limit).all()

def create_race(db: Session, race: schemas.RaceCreate) -> models.Race:
    race_data = race.model_dump()
    db_race = models.Race(**race_data)
    db.add(db_race)
    db.commit()
    db.refresh(db_race)
    return db_race

def update_race(db: Session, race_id: int, race_update: schemas.RaceUpdate) -> models.Race | None:
    db_race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not db_race:
        return None
    
    update_data = race_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_race, key, value)
        
    db.commit()
    db.refresh(db_race)
    return db_race

def get_race(db: Session, race_id: int) -> models.Race | None:
    return db.query(models.Race).filter(models.Race.id == race_id).first()

def get_track(db: Session) -> models.Track | None:
    return db.query(models.Track).first()

def create_track(db: Session, track: schemas.TrackCreate) -> models.Track:
    db_track = models.Track(**track.model_dump())
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track

def create_initial_config(db: Session, config: schemas.InitialConfigCreate) -> tuple[models.Group, models.Track]:
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

def update_group(db: Session, group: models.Group, name: str) -> models.Group:
    group.name = name
    db.commit()
    db.refresh(group)
    return group

def update_track(db: Session, track: models.Track, config: schemas.InitialConfigCreate) -> models.Track:
    track.lane_count = config.lane_count
    track.length_feet = config.length_feet
    track.timer_type = config.timer_type
    db.commit()
    db.refresh(track)
    return track

def get_racers(db: Session, skip: int = 0, limit: int = 100, race_id: int | None = None) -> List[models.Racer]:
    query = db.query(models.Racer)
    if race_id:
        query = query.filter(models.Racer.race_id == race_id)
    return query.offset(skip).limit(limit).all()

def create_racer(db: Session, racer: schemas.RacerCreate) -> models.Racer | None:
    # Ensure a race exists.
    race: models.Race | None = None
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

    assert race is not None

    racer_data = racer.model_dump()
    if 'race_id' in racer_data:
        del racer_data['race_id']
        
    den_id = racer_data.get("den_id")

    # Handle Racing Group based on Den
    if den_id:
        den = get_den(db, den_id)
        if den:
            # Find or create racing group for this Den
            racing_group = db.query(models.RacingGroup).filter(
                models.RacingGroup.race_id == race.id,
                models.RacingGroup.den_id == den_id
            ).first()

            if not racing_group:
                racing_group = models.RacingGroup(
                    race_id=race.id,
                    name=f"{den.name}s",
                    den_id=den_id
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

def update_racer(db: Session, racer_id: int, racer_update: schemas.RacerUpdate) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if not db_racer:
        return None
    
    update_data = racer_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racer, key, value)
        
    db.commit()
    db.refresh(db_racer)
    return db_racer

def delete_racer(db: Session, racer_id: int) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if db_racer:
        db.delete(db_racer)
        db.commit()
    return db_racer

def get_heats(db: Session, race_id: int) -> List[models.Heat]:
    return db.query(models.Heat).filter(models.Heat.race_id == race_id).order_by(models.Heat.round_number, models.Heat.heat_number).all()

def generate_heats(db: Session, race_id: int) -> List[models.Heat]:
    # 1. Get Race and Track Details
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return []
    
    # Assuming single track for now, getting the first one
    track = db.query(models.Track).first()
    lane_count = track.lane_count if track else 4

    # 2. Get Racers for this race
    racers = db.query(models.Racer).filter(models.Racer.race_id == race_id).all()
    if not racers:
        return []
    
    # Clear existing heats?
    db.query(models.Heat).filter(models.Heat.race_id == race_id).delete()
    db.commit()

    # 3. Simple Lane Rotation Algorithm
    racer_ids = [r.id for r in racers]
    
    generated_heats: List[models.Heat] = []
    
    # Use a copy we can rotate
    current_order = deque(racer_ids)
    
    for round_num in range(1, lane_count + 1):
        # Chunking
        for i in range(0, len(current_order), lane_count):
            heat_racers = list(current_order)[i : i + lane_count]
            
            # Map to lanes
            lane_assignment: List[dict[str, Any]] = []
            for lane_idx, r_id in enumerate(heat_racers):
                lane_assignment.append({
                    "lane": lane_idx + 1,
                    "racer_id": r_id,
                    "time": None,
                    "place": None
                })
            
            heat = models.Heat(
                race_id=race_id,
                round_number=round_num,
                heat_number=len(generated_heats) + 1,
                lane_results=json.dumps(lane_assignment)
            )
            db.add(heat)
            generated_heats.append(heat)
            
        # Rotate for next round
        current_order.rotate(1)
        
    db.commit()
    # Refresh/Reload all heats
    return get_heats(db, race_id)

def record_heat_result(db: Session, heat_id: int, results: str | None) -> models.Heat | None:
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat and results is not None:
        heat.lane_results = results
        db.commit()
        db.refresh(heat)
    return heat
