import enum
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, false
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


class HeatKind(str, enum.Enum):
    """Whether a heat counts toward standings.

    ``FREE`` is an exhibition run: the timer records it and the audience display
    shows it, but scoring, scheduling and advancement ignore it.

    Historically this distinguished two *tables* with overlapping autoincrement
    sequences, so a bare heat id was ambiguous and had to be carried around with
    its kind (issue #4). Issue #6 makes it a column on the one table, which is
    what makes an id unambiguous again.
    """

    OFFICIAL = "OFFICIAL"
    FREE = "FREE"


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
    rank: Mapped[Rank | None] = mapped_column(
        SAEnum(Rank), default=Rank.OTHER, nullable=True
    )
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    car_number_range_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    car_number_range_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="dens")
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="den")


class SchedulingStrategy(str, enum.Enum):
    PPC = "PPC"


class ScoringStrategy(str, enum.Enum):
    TIMED = "TIMED"
    POINTS = "POINTS"


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    # server_default keeps the model in step with migration 0002, which needs
    # one to add this NOT NULL column to tables that already have rows.
    debug_mode: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    races: Mapped[list["Race"]] = relationship("Race", back_populates="group")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True, default="Main Track")
    lane_count: Mapped[int] = mapped_column(Integer, default=4)
    length_feet: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timer_type: Mapped[TimerType] = mapped_column(
        SAEnum(TimerType), default=TimerType.FAKE
    )
    serial_port: Mapped[str | None] = mapped_column(String, nullable=True)

    races: Mapped[list["Race"]] = relationship("Race", back_populates="track")


class Race(Base):
    __tablename__ = "races"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("groups.id"))
    track_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tracks.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    date_time: Mapped[str | None] = mapped_column(String, nullable=True)
    location: Mapped[str | None] = mapped_column(String, nullable=True)
    car_numbering_strategy: Mapped[CarNumberingStrategy] = mapped_column(
        SAEnum(CarNumberingStrategy), default=CarNumberingStrategy.MANUAL
    )
    global_start_number: Mapped[int] = mapped_column(Integer, default=1)
    championship_trophies: Mapped[int] = mapped_column(Integer, default=3)

    scoring_strategy: Mapped[ScoringStrategy] = mapped_column(
        SAEnum(ScoringStrategy), default=ScoringStrategy.TIMED
    )
    rules_configuration: Mapped[str | None] = mapped_column(String, nullable=True)
    auto_advance_heat: Mapped[bool] = mapped_column(Boolean, default=False)

    group: Mapped["Group"] = relationship("Group", back_populates="races")
    track: Mapped[Optional["Track"]] = relationship("Track", back_populates="races")
    racing_groups: Mapped[list["RacingGroup"]] = relationship(
        "RacingGroup", back_populates="race"
    )
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="race")
    dens: Mapped[list["Den"]] = relationship(
        "Den", back_populates="race", cascade="all, delete-orphan"
    )
    rounds: Mapped[list["Round"]] = relationship(
        "Round", back_populates="race", cascade="all, delete-orphan"
    )
    # Both kinds; `Heat.kind` distinguishes them (#6).
    heats: Mapped[list["Heat"]] = relationship("Heat", back_populates="race")


class RacingGroup(Base):
    __tablename__ = "racing_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    name: Mapped[str] = mapped_column(String)
    den_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )
    car_number_range_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    car_number_range_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="racing_groups")
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="racing_group")


class Racer(Base):
    __tablename__ = "racers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    first_name: Mapped[str] = mapped_column(String)
    last_name: Mapped[str] = mapped_column(String)
    car_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    car_name: Mapped[str | None] = mapped_column(String, nullable=True)
    car_passed_inspection: Mapped[bool] = mapped_column(Boolean, default=False)
    car_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    racer_image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    car_image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    racing_group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racing_groups.id"), nullable=True
    )
    den_id: Mapped[int | None] = mapped_column(
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
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    scheduling_strategy: Mapped[SchedulingStrategy] = mapped_column(
        SAEnum(SchedulingStrategy), default=SchedulingStrategy.PPC
    )
    advancement_source: Mapped[str | None] = mapped_column(String, nullable=True)
    advancement_num_racers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    den_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="rounds")
    heats: Mapped[list["Heat"]] = relationship(
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
    """A heat, official or free (issue #6).

    ``kind`` is the difference. A free race heat is a heat that does not count
    toward standings — a flag, not a second table. Anything that reads heats for
    scoring, scheduling, advancement or statistics must say so; see
    :func:`official_heats`, which exists so the filter is hard to forget.
    """

    __tablename__ = "heats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    # Null for free race heats, which belong to no round.
    round_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("rounds.id"), nullable=True
    )
    kind: Mapped[HeatKind] = mapped_column(
        SAEnum(HeatKind),
        default=HeatKind.OFFICIAL,
        server_default="OFFICIAL",
        index=True,
    )
    heat_number: Mapped[int] = mapped_column(Integer)
    lane_results: Mapped[str | None] = mapped_column(String, nullable=True)
    # Free race heats are listed newest first; official heats order by round and
    # heat number and leave this null.
    created_at: Mapped[str | None] = mapped_column(String, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="heats")
    round: Mapped[Optional["Round"]] = relationship("Round", back_populates="heats")


def official_heats(query):
    """Restrict a ``Heat`` query to the heats that count.

    Free race heats live in the same table (#6), so every query that feeds
    standings, scheduling, advancement or statistics has to exclude them. Naming
    the filter makes its absence visible at the call site, which a bare
    ``.filter(Heat.kind == ...)`` scattered 25 times does not.
    """
    return query.filter(Heat.kind == HeatKind.OFFICIAL)


class HeatLane(Base):
    """One lane of one heat: an assignment, and possibly a result.

    Replaces the ``lane_results`` JSON blob, which encoded the schedule, the
    results, the placeholders for unadvanced championship slots, and the heat's
    status all in one string with no foreign key to a racer (issue #5).

    Identity
    --------
    ``heat_id`` is a real foreign key. It could not be one until #6 folded
    ``free_race_heats`` into ``heats``, because it would have had to reference
    two tables with overlapping autoincrement sequences at once.

    Placeholders
    ------------
    An unadvanced championship slot has ``racer_id`` null and
    ``placeholder_slot`` set to 1, 2, 3… The blob encoded these as *negative*
    racer ids, which a real foreign key cannot express. The slot is scheduling
    data in its own right — PPC decides which slot races in which lane when the
    round is created, long before anyone has qualified — so it has to be
    stored, not derived.

    A row with neither is an empty lane in a short heat.
    """

    __tablename__ = "heat_lanes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    heat_id: Mapped[int] = mapped_column(Integer, ForeignKey("heats.id"), index=True)
    lane: Mapped[int] = mapped_column(Integer)

    racer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racers.id"), nullable=True
    )
    placeholder_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Kept as a float rather than the blob's mixed float/string. A recorded 0.0
    # means the timer saw a start but never a finish; scoring turns that into a
    # DNF penalty.
    time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    place: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Set by the operator UI when a heat is passed over rather than run.
    skipped: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )
