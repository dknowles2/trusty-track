import enum
from typing import List, Optional
from sqlalchemy import Boolean, ForeignKey, Integer, String, Float, Enum as SAEnum
from sqlalchemy.orm import relationship, Mapped, mapped_column
from .database import Base

class TimerType(str, enum.Enum):
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    color: Mapped[str] = mapped_column(String, default="#000000")
    rank: Mapped[Optional[Rank]] = mapped_column(SAEnum(Rank), default=Rank.OTHER, nullable=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    car_number_range_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    car_number_range_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="dens")
    racers: Mapped[List["Racer"]] = relationship("Racer", back_populates="den")


class SchedulingStrategy(str, enum.Enum):
    LANE_ROTATION = "LANE_ROTATION"
    PPC = "PPC"
    STEARNS = "STEARNS"
    PERFECT_N = "PERFECT_N"
    CHAOTIC = "CHAOTIC"

class ScoringStrategy(str, enum.Enum):
    TIMED = "TIMED"
    POINTS = "POINTS"

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)

    races: Mapped[List["Race"]] = relationship("Race", back_populates="group")

class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lane_count: Mapped[int] = mapped_column(Integer, default=4)
    length_feet: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    timer_type: Mapped[TimerType] = mapped_column(SAEnum(TimerType), default=TimerType.FAKE)
    serial_port: Mapped[Optional[str]] = mapped_column(String, nullable=True)

class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("groups.id"))
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    date_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    car_numbering_strategy: Mapped[CarNumberingStrategy] = mapped_column(SAEnum(CarNumberingStrategy), default=CarNumberingStrategy.MANUAL)
    global_start_number: Mapped[int] = mapped_column(Integer, default=1)
    championship_trophies: Mapped[int] = mapped_column(Integer, default=3)
    
    scoring_strategy: Mapped[ScoringStrategy] = mapped_column(SAEnum(ScoringStrategy), default=ScoringStrategy.TIMED)
    rules_configuration: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    group: Mapped["Group"] = relationship("Group", back_populates="races")
    racing_groups: Mapped[List["RacingGroup"]] = relationship("RacingGroup", back_populates="race")
    racers: Mapped[List["Racer"]] = relationship("Racer", back_populates="race")
    dens: Mapped[List["Den"]] = relationship("Den", back_populates="race", cascade="all, delete-orphan")
    rounds: Mapped[List["Round"]] = relationship("Round", back_populates="race", cascade="all, delete-orphan")
    heats: Mapped[List["Heat"]] = relationship("Heat", back_populates="race")

class RacingGroup(Base):
    __tablename__ = "racing_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    name: Mapped[str] = mapped_column(String)
    den_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("dens.id"), nullable=True)
    car_number_range_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    car_number_range_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="racing_groups")
    racers: Mapped[List["Racer"]] = relationship("Racer", back_populates="racing_group")

class Racer(Base):
    __tablename__ = "racers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    first_name: Mapped[str] = mapped_column(String)
    last_name: Mapped[str] = mapped_column(String)
    car_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    car_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    car_passed_inspection: Mapped[bool] = mapped_column(Boolean, default=False)
    car_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    racer_image_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    car_image_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    racing_group_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("racing_groups.id"), nullable=True)
    den_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("dens.id"), nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="racers")
    racing_group: Mapped[Optional["RacingGroup"]] = relationship("RacingGroup", back_populates="racers")
    den: Mapped[Optional["Den"]] = relationship("Den", back_populates="racers")

class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    round_number: Mapped[int] = mapped_column(Integer)
    scheduling_strategy: Mapped[SchedulingStrategy] = mapped_column(SAEnum(SchedulingStrategy), default=SchedulingStrategy.LANE_ROTATION)

    race: Mapped["Race"] = relationship("Race", back_populates="rounds")
    heats: Mapped[List["Heat"]] = relationship("Heat", back_populates="round", cascade="all, delete-orphan")

class Heat(Base):
    __tablename__ = "heats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    round_id: Mapped[int] = mapped_column(Integer, ForeignKey("rounds.id"))
    heat_number: Mapped[int] = mapped_column(Integer)
    lane_results: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="heats")
    round: Mapped["Round"] = relationship("Round", back_populates="heats")
