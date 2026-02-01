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
    db_race = models.Race(**race.dict())
    db.add(db_race)
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

def get_racers(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Racer).offset(skip).limit(limit).all()

def create_racer(db: Session, racer: schemas.RacerCreate):
    # Ensure a race exists.
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
