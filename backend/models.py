import enum
from typing import List, Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    rank: Mapped[Optional[Rank]] = mapped_column(
        SAEnum(Rank), default=Rank.OTHER, nullable=True
    )
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    car_number_range_start: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    car_number_range_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="dens")
    racers: Mapped[List["Racer"]] = relationship("Racer", back_populates="den")


class SchedulingStrategy(str, enum.Enum):
    PPC = "PPC"


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
    name: Mapped[str] = mapped_column(String, index=True, default="Main Track")
    lane_count: Mapped[int] = mapped_column(Integer, default=4)
    length_feet: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    timer_type: Mapped[TimerType] = mapped_column(
        SAEnum(TimerType), default=TimerType.FAKE
    )
    serial_port: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    races: Mapped[List["Race"]] = relationship("Race", back_populates="track")


class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("groups.id"))
    track_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tracks.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    date_time: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    car_numbering_strategy: Mapped[CarNumberingStrategy] = mapped_column(
        SAEnum(CarNumberingStrategy), default=CarNumberingStrategy.MANUAL
    )
    global_start_number: Mapped[int] = mapped_column(Integer, default=1)
    championship_trophies: Mapped[int] = mapped_column(Integer, default=3)

    scoring_strategy: Mapped[ScoringStrategy] = mapped_column(
        SAEnum(ScoringStrategy), default=ScoringStrategy.TIMED
    )
    rules_configuration: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    group: Mapped["Group"] = relationship("Group", back_populates="races")
    track: Mapped[Optional["Track"]] = relationship("Track", back_populates="races")
    racing_groups: Mapped[List["RacingGroup"]] = relationship(
        "RacingGroup", back_populates="race"
    )
    racers: Mapped[List["Racer"]] = relationship("Racer", back_populates="race")
    dens: Mapped[List["Den"]] = relationship(
        "Den", back_populates="race", cascade="all, delete-orphan"
    )
    rounds: Mapped[List["Round"]] = relationship(
        "Round", back_populates="race", cascade="all, delete-orphan"
    )
    heats: Mapped[List["Heat"]] = relationship("Heat", back_populates="race")
    free_race_heats: Mapped[List["FreeRaceHeat"]] = relationship(
        "FreeRaceHeat", back_populates="race", cascade="all, delete-orphan"
    )


class RacingGroup(Base):
    __tablename__ = "racing_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    name: Mapped[str] = mapped_column(String)
    den_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )
    car_number_range_start: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
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
    racing_group_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("racing_groups.id"), nullable=True
    )
    den_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="racers")
    racing_group: Mapped[Optional["RacingGroup"]] = relationship(
        "RacingGroup", back_populates="racers"
    )
    den: Mapped[Optional["Den"]] = relationship("Den", back_populates="racers")


class Round(Base):
    __tablename__ = "rounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    round_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    scheduling_strategy: Mapped[SchedulingStrategy] = mapped_column(
        SAEnum(SchedulingStrategy), default=SchedulingStrategy.PPC
    )
    advancement_source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    advancement_num_racers: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )
    den_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="rounds")
    heats: Mapped[List["Heat"]] = relationship(
        "Heat", back_populates="round", cascade="all, delete-orphan"
    )
    den: Mapped[Optional["Den"]] = relationship("Den")

    @property
    def total_participants(self) -> int:
        """Calculate the total number of participants in this round."""
        if not self.advancement_source:
            # For general rounds, count unique racers in heats
            import json

            racer_ids = set()
            for heat in self.heats:
                if heat.lane_results:
                    try:
                        results = json.loads(heat.lane_results)
                        for r in results:
                            rid = r.get("racer_id")
                            if rid is not None:
                                racer_ids.add(rid)
                    except Exception:
                        pass
            return len(racer_ids)

        # For championship rounds
        if self.advancement_source == "PACK":
            return self.advancement_num_racers or 0
        elif self.advancement_source == "DEN":
            # Count dens in this race
            den_count = len(self.race.dens) if self.race else 0
            return (self.advancement_num_racers or 0) * den_count
        return self.advancement_num_racers or 0


class Heat(Base):
    __tablename__ = "heats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    round_id: Mapped[int] = mapped_column(Integer, ForeignKey("rounds.id"))
    heat_number: Mapped[int] = mapped_column(Integer)
    lane_results: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="heats")
    round: Mapped["Round"] = relationship("Round", back_populates="heats")


class FreeRaceHeat(Base):
    """A single heat run in Free Race mode. Never affects official standings."""

    __tablename__ = "free_race_heats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    # JSON array: [{"lane": 1, "racer_id": 42, "time": 3.141, "place": 1}, ...]
    # racer_id may be None for empty lanes.
    lane_assignments: Mapped[str] = mapped_column(String)
    # JSON array of results, same shape as lane_assignments but with time/place filled in.
    # Null until the heat is completed.
    lane_results: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String)  # ISO-8601 timestamp

    race: Mapped["Race"] = relationship("Race", back_populates="free_race_heats")

    @property
    def round_number(self) -> int:
        """Get the round number from the related Round."""
        return self.round.round_number if self.round else 0

    @property
    def round_name(self) -> Optional[str]:
        """Get the round name from the related Round."""
        return self.round.name if self.round else None

    @property
    def total_participants(self) -> int:
        """Get the total number of participants in this round."""
        return self.round.total_participants if self.round else 0

    @property
    def advancement_num_racers(self) -> Optional[int]:
        """Get the number of racers to advance to this round."""
        return self.round.advancement_num_racers if self.round else None

    @property
    def advancement_source(self) -> Optional[str]:
        """Get the advancement source from the related Round."""
        return self.round.advancement_source if self.round else None
