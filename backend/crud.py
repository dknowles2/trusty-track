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
