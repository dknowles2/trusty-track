import enum
from typing import Optional

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
)
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


class AwardKind(str, enum.Enum):
    """Where an award's recipient comes from — see :class:`Award`."""

    #: Computed from the standings: a source and a place.
    SPEED = "SPEED"
    #: Chosen by a person: Best Paint, Most Original, Judges' Choice.
    SPECIAL = "SPECIAL"


class SchedulingStrategy(str, enum.Enum):
    PPC = "PPC"
    #: Ladderless elimination: lose `Round.elimination_losses` heats and you
    #: are out; the schedule grows a wave at a time as results land, and the
    #: last car standing wins. See `domain/elimination.py`.
    ELIMINATION = "ELIMINATION"
    #: Balanced racing (GPRM calls it "Dynamic"): the first phase is random,
    #: and each later phase matches cars with similar records against each
    #: other, so more children get to win a heat. Everyone races once per
    #: phase, nobody is eliminated, and the round ends after
    #: `Round.balanced_phases` phases. See `domain/balanced.py`.
    BALANCED = "BALANCED"


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

    # Operator and check-in PINs, as `salt$hash` (#15). Null means unset, and an
    # unset *operator* PIN means no enforcement at all — see `api/auth.py`.
    # There is one Group per install, so this is where install-wide settings
    # live; it is not a per-race setting.
    operator_pin_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    checkin_pin_hash: Mapped[str | None] = mapped_column(String, nullable=True)

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
    #: Which timer model this track has, by ``TimerProfile.key``, or null to
    #: work it out.
    #:
    #: ``timer_type`` says how the timer is *reached* — not at all, over a
    #: serial port the backend holds, or over one the browser holds. This says
    #: *what it is*. They are separate questions: the same MicroWizard can be
    #: on either transport, and knowing the model does not tell you which.
    #:
    #: Null means probe for it, which is what every track did before #143.
    #: Naming a model matters for two reasons. Detection only works for a
    #: profile that answers an identifying question, and the NewBold family
    #: does not — so it was unreachable, shipped and impossible to select. And
    #: a probe *writes* to every port it tries, which an operator who already
    #: knows their hardware has no reason to allow.
    timer_profile: Mapped[str | None] = mapped_column(String, nullable=True)
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
    lane_outages: Mapped[list["LaneOutage"]] = relationship(
        "LaneOutage", back_populates="track", cascade="all, delete-orphan"
    )
    historical_records: Mapped[list["HistoricalTrackRecord"]] = relationship(
        "HistoricalTrackRecord", back_populates="track", cascade="all, delete-orphan"
    )


class HistoricalTrackRecord(Base):
    """A track record from before Trusty Track was keeping them.

    The computed records (`services/records.py`) never store anything — a
    corrected time must move them. A record set at the 2019 derby has no
    heats in this database to compute from, so it is the opposite case:
    primary data, entered by the operator, standing exactly as written. The
    same distinction the audit log draws — a claim about a moment that has
    passed.

    ``racer_name`` is free text, not a ``Racer`` foreign key: the child who
    set it is not on any roster this install has. ``race_name`` and
    ``race_date`` are labels for the sentence on the record board ("Derby
    2019, Mar 14 2019"), not references.

    Scoped to the **track** for the same reason a lane outage is — the
    record belongs to the hardware in the room — and deleted with it: a
    record of a track that no longer exists has nowhere to be shown.
    """

    __tablename__ = "track_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    track_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracks.id", ondelete="CASCADE"), index=True
    )
    time_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    racer_name: Mapped[str] = mapped_column(String, nullable=False)
    car_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    race_name: Mapped[str | None] = mapped_column(String, nullable=True)
    race_date: Mapped[str | None] = mapped_column(String, nullable=True)

    track: Mapped["Track"] = relationship("Track", back_populates="historical_records")


class LaneOutage(Base):
    """A lane of a track that is not currently usable (#171).

    A row per broken lane rather than a list on `Track`: a schedule asks "which
    lanes may I use", which is a set, and a set of small integers in a string
    column is the shape #5 spent a release removing. One row per outage also
    leaves somewhere to put a reason or a timestamp if this ever needs one.

    Presence is the whole meaning — a lane with no row is usable. There is no
    ``is_out_of_service`` flag, because a row saying a lane works is a row that
    can disagree with its own absence.

    Scoped to the **track**, not the race. The sensor is a property of the
    hardware in the room, and a venue running two races on one afternoon has
    the same dead lane in both.
    """

    __tablename__ = "lane_outages"
    __table_args__ = (UniqueConstraint("track_id", "lane", name="uq_lane_outage"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    track_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracks.id", ondelete="CASCADE"), index=True
    )
    lane: Mapped[int] = mapped_column(Integer, nullable=False)

    track: Mapped["Track"] = relationship("Track", back_populates="lane_outages")


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
    # The pack's weight limit, in ounces (#205).
    #
    # A column of its own rather than a key in ``rules_configuration``, which is
    # a free-text string nothing reads and nothing writes: a number in a string
    # column is the shape #5 spent a release removing, and the first thing to
    # need it should not put it back.
    #
    # Null means no check, which is what every race created before this had.
    # It is deliberately *not* given a server default — applying a limit to a
    # race already part-way through inspection would suddenly flag cars a
    # person had already passed. New races are offered 5.0 by the form instead.
    weight_limit_oz: Mapped[float | None] = mapped_column(Float, nullable=True)
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
    awards: Mapped[list["Award"]] = relationship(
        "Award", back_populates="race", cascade="all, delete-orphan"
    )


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
    #: A lane went out of service part-way through this round (#171).
    #:
    #: Set when an outage vacates lanes in heats that had not been run, which
    #: only happens to a round already under way — one that has not started is
    #: rebuilt for the lanes that remain, and one that has finished is left
    #: alone. The racers in those vacated lanes end up having raced fewer times
    #: than everybody else.
    #:
    #: What that costs depends entirely on the scoring strategy, which is why
    #: this is a flag rather than a correction: `TIMED` averages heat times, so
    #: an unequal count changes nothing, while `POINTS` **sums** placements, so
    #: a racer with one heat fewer scores *better*. `services/scoring` drops
    #: disrupted rounds from `POINTS` standings and keeps them for `TIMED`.
    disrupted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    #: The field is drawn from the *bottom* of the standings — a "Slowest
    #: Race" bracket, the just-for-fun mirror of a championship round. The
    #: source vocabulary is unchanged (`PACK`, `DEN`, `ROUND:<id>`); this flag
    #: only flips which end of those standings the slots are filled from.
    #: Cars that have not recorded a result are never picked — a car that
    #: never ran is not the slowest car, it is an absent one.
    advancement_from_bottom: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    #: Ladderless elimination only: how many heats a car may lose before it
    #: is out. Null for every other scheduling strategy — the column has no
    #: meaning without one, and a value nothing reads would be free to rot.
    elimination_losses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: Balanced racing only: how many phases the round runs — everyone races
    #: once per phase. Null for every other strategy, same reasoning as
    #: `elimination_losses`. GPRM recommends at least one phase per lane.
    balanced_phases: Mapped[int | None] = mapped_column(Integer, nullable=True)

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


class Award(Base):
    """One trophy, and where its recipient comes from (#170).

    Two kinds, and the difference is only that:

    ``SPEED``
        Names a **source** rather than a winner — ``source`` plus ``place``,
        optionally narrowed to one den. The recipient is computed from the
        standings every time it is asked for, so it stays correct when a time
        is corrected after the award was defined. Storing the racer id here
        would make this the first thing in the app able to disagree with the
        leaderboard, which is the loop #17 closed.

    ``SPECIAL``
        Carries ``racer_id``, chosen by a person, and no source. Best Paint,
        Most Original, Judges' Choice — the awards every pack actually gives
        and the app had nowhere to record.

    ``racer_id`` sets null rather than cascading: deleting a racer should
    un-assign the award, not delete the trophy. An award with no recipient is
    an ordinary state — most of them have none until the end of the event.

    The rules are in :mod:`backend.domain.awards`; this is where they are
    stored, and ``services/awards.py`` is what loads standings for them.

    ``championship_trophies`` on `Race` is *not* this. It means how many cars
    advance to the final, which is a scheduling input; an award is an outcome.
    """

    __tablename__ = "awards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    race_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("races.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[AwardKind] = mapped_column(
        SAEnum(AwardKind), nullable=False, default=AwardKind.SPECIAL
    )
    #: Presentation order. Awards are announced in sequence at the end of an
    #: event, and the order is the operator's choice — usually the speed awards
    #: last, because that is the one everybody is waiting for.
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    #: SPEED only. ``"PACK"`` or ``"ROUND:<id>"``, the same vocabulary
    #: `Round.advancement_source` uses — but never ``"DEN"``; see
    #: `domain/awards.py` for why a den-scoped award sets `den_id` instead.
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    #: SPEED only, 1-based: 1 is the winner.
    place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: SPEED only. Which end of the standings ``place`` counts from — false is
    #: the fastest car, true the slowest. The same flip
    #: `Round.advancement_from_bottom` makes for a Slowest Race bracket, and
    #: for the same reason: a pack that gives a trophy to the slowest car is
    #: reading the standings it already has from the other end.
    from_bottom: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    #: SPEED only. Narrows the standings to one den, so "fastest Wolf" is the
    #: ordinary standings filtered rather than a third kind of source.
    den_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("dens.id", ondelete="CASCADE"), nullable=True
    )

    #: SPECIAL only. Null until somebody decides.
    racer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racers.id", ondelete="SET NULL"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="awards")


class HeatLaneBlobArchive(Base):
    """Blobs that could not be rebuilt from ``heat_lanes`` (#72, migration 0013).

    Expected to be empty, on every install. ``lane_results`` was the only copy
    of anything the table does not model — a time that was not a number, or a
    key no version ever wrote — so the migration that dropped the column
    verified each blob against a rebuild first and parked the ones that did not
    match rather than losing them.

    An empty table is the evidence that this install's drop was clean. Nothing
    reads it; it is a record, and `0013`'s downgrade restores from it.
    """

    __tablename__ = "heat_lane_blob_archive"

    heat_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lane_results: Mapped[str | None] = mapped_column(String, nullable=True)


class AuditEntry(Base):
    """One thing somebody did, and when (#219).

    The database holds the current state of a race and no record of how it got
    there, so "who deleted that round" had no answer but whoever happened to be
    watching. This is that record.

    **`race_id` is a plain integer, not a foreign key**, and that is the one
    place this table departs from the rule that deletion is the schema's job
    (#125). Every other child of a race cascades away with it; these must not.
    Deleting a race is itself the most consequential line the log can hold, and
    a cascade would erase the context of the deletion at the moment it happened
    — the log would be able to say a race was deleted and nothing about what
    was done to it beforehand. An entry outlives what it describes on purpose.

    Nothing here is ever updated. Rows are appended and, once the table reaches
    its cap, the oldest are dropped; see `crud.prune_audit_log`.
    """

    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    #: ISO 8601 UTC, stored as text like every other timestamp in this schema.
    at: Mapped[str] = mapped_column(String, nullable=False, index=True)
    #: The mutation's field name, or one of the names in `domain.audit` for the
    #: seams that are not mutations.
    action: Mapped[str] = mapped_column(String, nullable=False, index=True)
    #: `domain.audit.ActorRole`. A role rather than a person: this app has no
    #: user accounts, and a log that implied otherwise would be lying.
    role: Mapped[str] = mapped_column(String, nullable=False)
    #: `domain.audit.Outcome` — whether it happened, was refused, or raised.
    outcome: Mapped[str] = mapped_column(String, nullable=False)
    #: Where the request came from. Null for the timer and for anything else
    #: the app does without a request behind it.
    source_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    #: Which race it concerned, when that is knowable. See the class note.
    race_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    #: A small JSON object of scalars, already filtered by `domain.audit.redact`.
    details: Mapped[str | None] = mapped_column(String, nullable=True)
