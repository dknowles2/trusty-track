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
    #: This track has a solenoid on the start gate, so software can release it.
    #:
    #: A setting rather than something detected, because nothing in any timer
    #: protocol says whether the accessory is fitted. It is off by default: the
    #: cost of a wrong `False` is a button that is not offered, and the cost of
    #: a wrong `True` is a gate that opens with nobody expecting it.
    remote_start_installed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

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
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="race")
    dens: Mapped[list["Den"]] = relationship(
        "Den", back_populates="race", cascade="all, delete-orphan"
    )
    rounds: Mapped[list["Round"]] = relationship(
        "Round", back_populates="race", cascade="all, delete-orphan"
    )
    # Both kinds; `Heat.kind` distinguishes them (#6).
    heats: Mapped[list["Heat"]] = relationship("Heat", back_populates="race")


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
    den_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("dens.id"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="racers")
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
        """How many racers this round is sized for.

        For a championship round that is :func:`advancement.field_size`, not a
        sixth copy of it (#52). This property held the rule correctly while two
        of its four siblings had it wrong, which is exactly how that goes.
        """
        from backend.domain import advancement

        if not self.advancement_source:
            # A general round's field is whoever is actually in its heats.
            # Straight off `heat_lanes`, which is where a heat's racers live
            # (#72) — the relationship gives the rows without a query per heat.
            from sqlalchemy.orm import object_session

            session = object_session(self)
            if session is None or not self.heats:
                return 0
            # One query, not one per heat. Deliberately not an ORM
            # relationship on `Heat`: `lane_sync` writes these rows with core
            # inserts and deletes, and a collection SQLAlchemy thinks it owns
            # would be arguing with it.
            racer_ids = {
                racer_id
                for (racer_id,) in session.query(HeatLane.racer_id)
                .filter(
                    HeatLane.heat_id.in_([h.id for h in self.heats]),
                    HeatLane.racer_id.isnot(None),
                )
                .distinct()
            }
            return len(racer_ids)

        rule = advancement.AdvancementRule(
            source=self.advancement_source, num_racers=self.advancement_num_racers
        )
        den_count = len(self.race.dens) if self.race else 0
        return advancement.field_size(rule, den_count)


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
    # When a result was last recorded, ISO 8601 UTC. Null means no result — the
    # two are kept in step by `crud.stamp_recorded`.
    #
    # This is the only ordering that compares an official heat against a free
    # one. `created_at` cannot: for a free heat it is when the heat was made,
    # which is near enough when it ran, but for an official heat it is when the
    # round was generated, long before. Schedule order cannot either — it says
    # nothing about when a heat was re-recorded. See #59.
    #
    # A string rather than a DateTime to match `created_at` in the same table.
    # ISO 8601 UTC sorts lexicographically the same as chronologically.
    recorded_at: Mapped[str | None] = mapped_column(String, nullable=True)

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

    Deletion
    --------
    Both foreign keys carry an ``ON DELETE`` action, which became load-bearing
    the moment enforcement was turned on (#125): four delete paths in
    ``crud.py`` remove a parent while lane rows still point at it, and each was
    relying on nothing checking.

    ``heat_id`` cascades — a lane has no meaning without its heat, and
    ``lane_sync`` was already doing this in Python from an ``after_flush``
    listener, which is *after* the ``DELETE FROM heats`` the database would now
    refuse.

    ``racer_id`` sets null, which is the clause #72 step 4 wants and the thing
    ``crud._remove_racer_from_regular_heats`` and ``_remove_racer_from_free_heats``
    hand-roll today. Those two still run, because they also rewrite the
    ``lane_results`` blob that the table is projected alongside; what they no
    longer have to be is *first*.
    """

    __tablename__ = "heat_lanes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    heat_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("heats.id", ondelete="CASCADE"), index=True
    )
    lane: Mapped[int] = mapped_column(Integer)

    racer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racers.id", ondelete="SET NULL"), nullable=True
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
