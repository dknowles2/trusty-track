import enum
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Enum as SAEnum
from sqlalchemy.orm import relationship
from .database import Base

class TimerType(str, enum.Enum):
    SKIP = "SKIP"
    FAKE = "FAKE"
    AUTO_DETECT_BACKEND = "AUTO_DETECT_BACKEND"
    AUTO_DETECT_PROXY = "AUTO_DETECT_PROXY"

class CarNumberingStrategy(str, enum.Enum):
    PER_GROUP = "PER_GROUP"
    GLOBAL = "GLOBAL"
    MANUAL = "MANUAL"

class Rank(str, enum.Enum):
    LION = "LION"
    TIGER = "TIGER"
    WOLF = "WOLF"
    BEAR = "BEAR"
    WEBELOS = "WEBELOS"
    ARROW_OF_LIGHT = "ARROW_OF_LIGHT"
    OTHER = "OTHER"

class Den(Base):
    __tablename__ = "dens"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    color = Column(String, default="#000000")
    rank = Column(SAEnum(Rank), default=Rank.OTHER, nullable=True) # Optional link to traditional rank

    racers = relationship("Racer", back_populates="den")


class SchedulingStrategy(str, enum.Enum):
    LANE_ROTATION = "LANE_ROTATION"
    PERFECT_N = "PERFECT_N"
    CHAOTIC = "CHAOTIC"

class ScoringStrategy(str, enum.Enum):
    TIMED = "TIMED"
    POINTS = "POINTS"

class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    races = relationship("Race", back_populates="group")

class Track(Base):
    __tablename__ = "tracks"

    id = Column(Integer, primary_key=True, index=True)
    lane_count = Column(Integer, default=4)
    length_feet = Column(Integer, nullable=True)
    timer_type = Column(SAEnum(TimerType), default=TimerType.SKIP)
    serial_port = Column(String, nullable=True)

class Race(Base):
    __tablename__ = "races"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    name = Column(String, unique=True, index=True)
    date_time = Column(String, nullable=True) # ISO format or similar
    location = Column(String, nullable=True)
    car_numbering_strategy = Column(SAEnum(CarNumberingStrategy), default=CarNumberingStrategy.MANUAL)
    global_start_number = Column(Integer, default=1)
    
    scheduling_strategy = Column(SAEnum(SchedulingStrategy), default=SchedulingStrategy.LANE_ROTATION)
    scoring_strategy = Column(SAEnum(ScoringStrategy), default=ScoringStrategy.TIMED)
    rules_configuration = Column(String, nullable=True) # JSON string

    group = relationship("Group", back_populates="races")
    racing_groups = relationship("RacingGroup", back_populates="race")
    racers = relationship("Racer", back_populates="race")
    heats = relationship("Heat", back_populates="race")

class RacingGroup(Base):
    __tablename__ = "racing_groups"

    id = Column(Integer, primary_key=True, index=True)
    race_id = Column(Integer, ForeignKey("races.id"))
    name = Column(String)
    den_id = Column(Integer, ForeignKey("dens.id"), nullable=True)
    car_number_range_start = Column(Integer, nullable=True)
    car_number_range_end = Column(Integer, nullable=True)

    race = relationship("Race", back_populates="racing_groups")
    racers = relationship("Racer", back_populates="racing_group")

class Racer(Base):
    __tablename__ = "racers"

    id = Column(Integer, primary_key=True, index=True)
    race_id = Column(Integer, ForeignKey("races.id"))
    first_name = Column(String)
    last_name = Column(String)
    car_number = Column(Integer) # Should be unique per race, logic to enforce this needed
    car_name = Column(String, nullable=True)
    car_passed_inspection = Column(Boolean, default=False)
    racer_image_url = Column(String, nullable=True)
    car_image_url = Column(String, nullable=True)
    racing_group_id = Column(Integer, ForeignKey("racing_groups.id"), nullable=True)
    den_id = Column(Integer, ForeignKey("dens.id"), nullable=True)

    race = relationship("Race", back_populates="racers")
    racing_group = relationship("RacingGroup", back_populates="racers")
    den = relationship("Den", back_populates="racers")

class Heat(Base):
    __tablename__ = "heats"

    id = Column(Integer, primary_key=True, index=True)
    race_id = Column(Integer, ForeignKey("races.id"))
    round_number = Column(Integer)
    heat_number = Column(Integer)
    lane_results = Column(String) # JSON string storing results

    race = relationship("Race", back_populates="heats")
