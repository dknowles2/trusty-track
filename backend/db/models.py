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
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class TimerType(str, enum.Enum):
    FAKE = "FAKE"
    AUTO_DETECT_BACKEND = "AUTO_DETECT_BACKEND"
    AUTO_DETECT_PROXY = "AUTO_DETECT_PROXY"
    #: No timer exists for this track. Arming is refused (#490) and hand
    #: entry through the Override/Edit modal is how every result gets
    #: recorded — see `services/timer/devices/no_timer.py`.
    NONE = "NONE"


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


class RacingGroup(Base):
    __tablename__ = "racing_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    color: Mapped[str] = mapped_column(String, default="#000000")
    # Free text (#496 stage 2), where it was a seven-value `Rank` enum. Nothing
    # server-side reads this value to decide anything — `services/scoring.py`
    # passes it straight through onto the leaderboard for branding (#298) — so
    # there is no backend-owned vocabulary to constrain it against, the same
    # reasoning `Track.timer_profile` and `Race.appearance_theme` already
    # follow. The frontend's racing-group form offers the traditional Cub
    # Scout ranks as picker suggestions (`categoryPresets.ts`) rather than a
    # constraint, so a school typing "3rd Grade" is exactly as valid as a pack
    # picking "Wolf". The migration that dropped the enum carried every stored
    # value to the display string `rankLabel()` used to compute (`LION` to
    # "Lion"), so a value already on a racer's record needs no further lookup
    # here — the stored text is the label.
    division: Mapped[str | None] = mapped_column(String, nullable=True)
    race_id: Mapped[int] = mapped_column(Integer, ForeignKey("races.id"))
    car_number_range_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    car_number_range_end: Mapped[int | None] = mapped_column(Integer, nullable=True)

    race: Mapped["Race"] = relationship("Race", back_populates="racing_groups")
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="racing_group")


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
    """See `backend/domain/scoring.py` for what each member means and how it
    aggregates. ``CUMULATIVE_TIME`` and ``FASTEST_TIME`` (#547 stage 1) are
    GPRM's remaining two scoring methods; the module docstring there is the
    one place their rules are written out."""

    TIMED = "TIMED"
    POINTS = "POINTS"
    CUMULATIVE_TIME = "CUMULATIVE_TIME"
    FASTEST_TIME = "FASTEST_TIME"


class TiebreakMethod(str, enum.Enum):
    """How a shared score is broken at a cut — advancement, an award's place,
    the standings themselves (#540). Values equal names, same as
    `ScoringStrategy`, so they cross into `backend.domain.tiebreak` as plain
    strings unchanged; that module holds the same five constants and the
    rules for each.

    `SHARED` is the default and is not a no-op *feature* so much as a no-op
    *outcome*: it leaves a tie exactly as unresolved as it is today, which is
    what an install upgrading into this needs — the same reasoning
    `weight_limit_oz` (#205) and `display_theme`'s `"MATCH_APP"` (#498) both
    follow for their own off states.
    """

    SHARED = "SHARED"
    BEST_TIME = "BEST_TIME"
    TOTAL_TIME = "TOTAL_TIME"
    COUNTBACK = "COUNTBACK"
    HEAD_TO_HEAD = "HEAD_TO_HEAD"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True)
    # server_default keeps the model in step with migration 0002, which needs
    # one to add this NOT NULL column to tables that already have rows.
    debug_mode: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false()
    )

    # Operator and check-in PINs, as `salt$hash` (#15). Null means unset, and an
    # unset *operator* PIN means no enforcement at all — see `api/auth.py`.
    # There is one Organization per install, so this is where install-wide settings
    # live; it is not a per-race setting.
    operator_pin_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    checkin_pin_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    # Which theme the Display and Printables surfaces render (#498). A
    # `ThemeKey` (`frontend/src/theming/themes.ts` — the frontend holds the
    # one canonical copy of what a theme actually is, the same way the
    # backend holds the one copy of a timer profile) or the sentinel
    # `"MATCH_APP"`, never validated here: this column is a passthrough, not
    # a rule the backend branches on.
    #
    # Plain `String`, not `SAEnum` — unlike `TimerType`/`ScoringStrategy`,
    # nothing server-side reads this value to decide anything, so there is no
    # backend-owned vocabulary to constrain it against (the same reasoning
    # `Track.timer_profile` already follows).
    #
    # `MATCH_APP` is itself the "off"/default state, so unlike
    # `weight_limit_oz` or the PINs there is no bare-null "leave alone versus
    # clear" ambiguity needing a separate clear flag: absent on the input
    # means leave alone, and any explicit string — including `"MATCH_APP"` —
    # is a real value to set. See `InitialConfigInput` in `api/schema.py`.
    #
    # Per *install*, not per device — the opposite of the App theme, which
    # lives only in each device's `localStorage` (#498's "Where a theme is
    # picked"): walking to every wall display and check-in tablet to set the
    # same Display/Printables theme on each defeats the point of the existing
    # Displays system, which already pushes view state from the operator's
    # own list.
    display_theme: Mapped[str] = mapped_column(
        String, default="MATCH_APP", server_default=sa_text("'MATCH_APP'")
    )
    printables_theme: Mapped[str] = mapped_column(
        String, default="MATCH_APP", server_default=sa_text("'MATCH_APP'")
    )

    # The install-wide default words for a racing group and for the
    # organization itself (#496 stage 3) — what every screen and printout
    # called "Den" and "Pack" before this existed. Each stored as a singular
    # and a plural, because English plurals are irregular and deriving
    # "Classes" from "Class" is a rule nobody should own.
    #
    # Null means "use the built-in Scouting word" — there is deliberately no
    # non-null sentinel the way `display_theme` has `"MATCH_APP"`, because an
    # organization's own name for this concept could legitimately *be* any
    # string a `"DEFAULT"` sentinel might otherwise claim. That makes this
    # column shaped like `weight_limit_oz` and the PIN, not like the themes
    # above: absent on the input means leave alone, and there has to be a
    # separate `clearTerminology` flag to get back to null (see
    # `InitialConfigInput` in `api/schema.py`).
    #
    # `domain/terminology.py` is the one place that resolves these into what
    # a screen should actually show — never read directly for display.
    racing_group_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    racing_group_plural: Mapped[str | None] = mapped_column(String, nullable=True)
    organization_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    organization_plural: Mapped[str | None] = mapped_column(String, nullable=True)
    # The install-wide default word for a racer's vehicle (#551) — "Car" by
    # default, wrong for a Space Derby (rockets) or a Raingutter Regatta
    # (boats). Same null-means-inherit shape as the four columns above, and
    # the same reason there is no non-null sentinel: an organization's own
    # word for this could legitimately be any string. Deliberately not a
    # rename of `car_number`/`car_name`/`CarNumberingStrategy` and the rest —
    # those are storage and API, not display copy; only the word a screen
    # shows is configurable.
    vehicle_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_plural: Mapped[str | None] = mapped_column(String, nullable=True)

    races: Mapped[list["Race"]] = relationship("Race", back_populates="organization")


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
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id")
    )
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
    # How a shared score is broken at a cut — advancement, an award's place
    # (#540). `SHARED` (not resolved, today's silent behaviour made visible)
    # is the default, and needs a `server_default` — unlike `scoring_strategy`
    # above — because it is landing on a table that already has rows; every
    # existing race gets `SHARED` and reads no differently than it did before
    # this column existed. See `domain.tiebreak` for what each value does.
    tiebreaker: Mapped[TiebreakMethod] = mapped_column(
        SAEnum(TiebreakMethod),
        default=TiebreakMethod.SHARED,
        server_default=sa_text("'SHARED'"),
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
    #: Whether a phone holding no PIN may vote for a `SPECIAL` award right now
    #: (#305). The one exception to `Role.VIEWER: frozenset()` in `api/auth.py`
    #: rides on this being true — see `crud.cast_vote`. An operator toggle, not
    #: coupled to racing progress: closing it before the ceremony is judgment,
    #: not something this column enforces. Off by default, like every other
    #: install-wide switch here (the PIN, the chime) — an upgraded install does
    #: not suddenly start accepting ballots.
    voting_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # A per-race override of the organization's terminology (#496 stage 3) —
    # the venue running the pack derby in March and the school science fair
    # in May under one install and one organization. Null means "inherit the
    # organization's word", the same layering as `Organization`'s own
    # columns above, and needs the same `clearTerminology` flag to get back
    # to null once set — see `RaceUpdateInput` in `api/schema.py`.
    racing_group_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    racing_group_plural: Mapped[str | None] = mapped_column(String, nullable=True)
    organization_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    organization_plural: Mapped[str | None] = mapped_column(String, nullable=True)
    # A per-race override of the organization's vehicle word (#551), the
    # same shape and the same `clearTerminology` flag as the four columns
    # above.
    vehicle_singular: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_plural: Mapped[str | None] = mapped_column(String, nullable=True)
    #: One interleaved running order across the race's racing groups, rather
    #: than a block per group (#549 stage 2). Off by default — running one
    #: den at a time is how many packs deliberately structure an event, and
    #: this changes only the *sequence* heats run in, never what a round
    #: schedules or how it scores (`domain/running_order.py`). Applied by
    #: `applyMasterRunningOrder`, which writes `Heat.heat_number` through the
    #: same door `reorderHeats` uses; nothing here reorders heats by itself.
    master_running_order: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", back_populates="races"
    )
    track: Mapped[Optional["Track"]] = relationship("Track", back_populates="races")
    racers: Mapped[list["Racer"]] = relationship("Racer", back_populates="race")
    racing_groups: Mapped[list["RacingGroup"]] = relationship(
        "RacingGroup", back_populates="race", cascade="all, delete-orphan"
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
    racing_group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racing_groups.id"), nullable=True
    )

    race: Mapped["Race"] = relationship("Race", back_populates="racers")
    racing_group: Mapped[Optional["RacingGroup"]] = relationship(
        "RacingGroup", back_populates="racers"
    )


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
    racing_group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racing_groups.id"), nullable=True
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
    #: source vocabulary is unchanged (`ALL`, `EACH_GROUP`, `ROUND:<id>`); this flag
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
    racing_group: Mapped[Optional["RacingGroup"]] = relationship("RacingGroup")

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
        racing_group_count = len(self.race.racing_groups) if self.race else 0
        return advancement.field_size(rule, racing_group_count)


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
        optionally narrowed to one racing group. The recipient is computed from the
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

    #: SPEED only. ``"ALL"`` or ``"ROUND:<id>"``, the same vocabulary
    #: `Round.advancement_source` uses — but never ``"EACH_GROUP"``; see
    #: `domain/awards.py` for why a racing-group-scoped award sets
    #: `racing_group_id` instead.
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
    #: SPEED only. Narrows the standings to one racing group, so "fastest Wolf" is the
    #: ordinary standings filtered rather than a third kind of source.
    racing_group_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racing_groups.id", ondelete="CASCADE"), nullable=True
    )

    #: SPECIAL only. Null until somebody decides.
    racer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("racers.id", ondelete="SET NULL"), nullable=True
    )

    #: Which clipart to draw on the ceremony slide and the certificate (#306).
    #: Null means a plain certificate — the ordinary state for an award nobody
    #: has picked artwork for. `SPEED` awards get this defaulted from their
    #: rule (`crud._set_speed_artwork_key`) rather than offered as a picker;
    #: `SPECIAL` awards get it from the ready-made superlative picker, or
    #: whatever the operator typed over it, and nothing here validates the
    #: value against a known set — an artwork key an old frontend build does
    #: not recognise should print blank, not fail to save.
    artwork_key: Mapped[str | None] = mapped_column(String, nullable=True)

    #: SPECIAL only. Whether this award takes ballots while `Race.voting_open`
    #: is true (#305) — a pack deciding an award privately switches it off.
    #: Always false for `SPEED`; `crud._clear_fields_of_other_kind` forces it,
    #: the same way it forces `racer_id` null for the other kind. Off by
    #: default at the database, so an award that existed before this shipped
    #: does not suddenly start collecting ballots; `AwardInput` defaults new
    #: judged awards to on, the same "form offers a sensible default, the
    #: column stays conservative" shape as the weight limit (#205).
    votable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    race: Mapped["Race"] = relationship("Race", back_populates="awards")
    votes: Mapped[list["AwardVote"]] = relationship(
        "AwardVote", back_populates="award", cascade="all, delete-orphan"
    )


class AwardVote(Base):
    """One ballot for a `SPECIAL` award (#305).

    A vote has nothing to recompute it from — unlike a recipient, which
    `services/awards.py` works out fresh from the standings on every read
    (#170), a ballot *is* the record, so it is a row rather than a computed
    answer. See `services/awards.vote_tallies_for` for the count and
    `crud.cast_vote` for the write, which is the only place one of these is
    created.

    ``ballot_key`` is a client-generated token, unique per award
    (``uq_award_ballot``). It exists only to make one *submission* idempotent
    against a doubled click or a retried request — never to limit how many
    times a device may vote. A shared iPad at the event casts many ballots on
    purpose, and stuffing that box is accepted as a possibility rather than
    guarded against: whether it is a problem is a decision about what the
    trophy is worth, and it is the pack's to make, not the app's to enforce.

    Both foreign keys cascade. Deleting the award deletes its ballots — a vote
    for a trophy that no longer exists names nothing worth keeping; deleting
    the racer does the same, because an anonymous vote for a car that is gone
    from the roster has nothing left for the tally to attribute it to.
    """

    __tablename__ = "award_votes"
    __table_args__ = (
        UniqueConstraint("award_id", "ballot_key", name="uq_award_ballot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    award_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("awards.id", ondelete="CASCADE"), index=True
    )
    racer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("racers.id", ondelete="CASCADE"), index=True
    )
    ballot_key: Mapped[str] = mapped_column(String, nullable=False)
    # ISO 8601 UTC, the same shape and reason as `Heat.recorded_at`: a string
    # sorts lexicographically the same as chronologically, so there is no
    # SQLite-specific datetime type to round-trip.
    cast_at: Mapped[str] = mapped_column(String, nullable=False)

    award: Mapped["Award"] = relationship("Award", back_populates="votes")


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
