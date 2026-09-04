"""Validated inputs for `crud`.

**Inputs only.** These were once both halves of a REST API — request bodies and
response bodies — and the response half outlived it: Strawberry types describe
what goes out, so `schemas.Race`, `schemas.Heat` and the rest were built by
nothing and read by nobody for as long as the GraphQL migration has been done.
Twenty-one such classes were deleted, along with the `HeatReorder*`, `Wizard*`
and `BulkRacer*` request models whose endpoints became mutations.

What is left is what `crud` takes: a `*Create` or `*Update` per entity, and the
`*Base` classes they share. If a new class here is not named for an input,
check that something actually constructs it.
"""

from pydantic import BaseModel, field_validator

from backend.domain.scale_speed import DEFAULT_SCALE

from .models import (
    AwardKind,
    CarNumberingStrategy,
    ScoringStrategy,
    TiebreakMethod,
    TimerType,
)


class TrackBase(BaseModel):
    name: str = "Main Track"
    lane_count: int = 4
    length_feet: int | None = None
    timer_type: TimerType = TimerType.FAKE
    serial_port: str | None = None
    #: `TimerProfile.key`, or None to detect the model. See `models.Track`.
    timer_profile: str | None = None
    remote_start_installed: bool = False
    #: The timer's own lane 1 is wired to this track's highest lane. See
    #: `models.Track.reverse_lanes`.
    reverse_lanes: bool = False
    #: The vehicle-to-real-life ratio scale speed is computed against
    #: (#610). See `models.Track.scale_ratio`.
    scale_ratio: float = DEFAULT_SCALE
    #: Whether scale speed is offered on this track's surfaces at all. See
    #: `models.Track.show_scale_speed`.
    show_scale_speed: bool = True

    @field_validator("lane_count")
    @classmethod
    def lane_count_is_plausible(cls, value: int) -> int:
        """Refuse a lane count nothing downstream can act on.

        Zero silently schedules nothing (`generate_ppc` refuses an empty
        lane set). Negative is worse: `prepare_heat` and `startTimerTest`
        both compute `(1 << lane_count) - 1` as a lane mask, and a negative
        shift count raises rather than returning a heat sheet — an
        unhandled 500 far from the mistake that caused it. The upper bound
        matches the settings form's own `max="8"`.
        """
        if not 1 <= value <= 8:
            raise ValueError("lane_count must be between 1 and 8")
        return value

    @field_validator("scale_ratio")
    @classmethod
    def scale_ratio_is_positive(cls, value: float) -> float:
        """Refuse a ratio `scale_mph` could never use.

        A zero or negative ratio is not a smaller scale, it is nonsense —
        `domain.scale_speed.scale_mph` already treats a non-positive scale
        as "cannot compute" and returns `None`, so a track saved with one
        would silently never show a speed. Catching it here gives the
        operator a sentence instead of a quiet no-op.
        """
        if value <= 0:
            raise ValueError("the scale ratio must be greater than zero")
        return value


class HistoricalTrackRecordBase(BaseModel):
    """A record from before Trusty Track was keeping them, as typed in."""

    time_seconds: float
    racer_name: str
    car_number: int | None = None
    race_name: str | None = None
    race_date: str | None = None

    @field_validator("time_seconds")
    @classmethod
    def time_is_a_result(cls, value: float) -> float:
        """Refuse a time of zero or less where the number arrives.

        The computed records treat a stored 0.0 as a DNF marker, and a
        hand-entered zero would be the fastest time the track has ever
        seen.
        """
        if value <= 0:
            raise ValueError("a record time must be more than zero seconds")
        return value

    @field_validator("racer_name")
    @classmethod
    def racer_has_a_name(cls, value: str) -> str:
        """A record with no holder is not a record; refuse the blank."""
        if not value.strip():
            raise ValueError("a record names the racer who set it")
        return value.strip()


class HistoricalTrackRecordCreate(HistoricalTrackRecordBase):
    pass


class RacingGroupBase(BaseModel):
    name: str
    color: str = "#000000"
    division: str | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


class RacingGroupCreate(RacingGroupBase):
    pass


class RacingGroupUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    division: str | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


class TrackCreate(TrackBase):
    pass


class InitialConfigCreate(BaseModel):
    organization_name: str
    debug_mode: bool = False
    tracks: list[TrackCreate]
    # Accepted and ignored here: the PINs are hashed in `schema._apply_pins`
    # rather than carried through `crud`, so a plaintext PIN never reaches a
    # persistence helper. Declared so `strawberry.asdict(config)` can be handed
    # over whole without the extra keys raising.
    operator_pin: str | None = None
    checkin_pin: str | None = None
    # Display/Printables theme, or None to take the column's own default
    # (`"MATCH_APP"`) — see `models.Organization.display_theme`. Unlike the PINs,
    # these are ordinary column values `crud.create_initial_config` sets
    # directly; there is nothing to hash.
    display_theme: str | None = None
    printables_theme: str | None = None
    # Accepted and ignored here, like the PINs above: the install-wide
    # terminology default is applied in `schema._apply_terminology` straight
    # onto the ORM row, not through this pydantic schema. Declared so
    # `strawberry.asdict(config)` can be handed over whole without the extra
    # keys raising.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    vehicle_artwork_key: str | None = None
    clear_terminology: bool = False
    # The install-wide default for how much of a racer's name a public
    # screen may show (#552) — one of `domain.name_display.NAME_DISPLAY_VALUES`,
    # or None to take the column's own default (`"FULL"`). Like
    # `display_theme` above, an ordinary column value `crud.create_initial_config`
    # sets directly, and `"FULL"` is itself the reachable "off" state, so
    # there is no clear flag to carry.
    name_display: str | None = None


class RacerBase(BaseModel):
    first_name: str
    last_name: str
    car_number: int | None = None
    racing_group_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool = False
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None
    #: Races, but is not ranked (#548). Off by default, same as
    #: `car_passed_inspection` above.
    excluded_from_standings: bool = False


class RacerCreate(RacerBase):
    race_id: int | None = None


class RacerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    car_number: int | None = None
    racing_group_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool | None = None
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None
    excluded_from_standings: bool | None = None


class RaceBase(BaseModel):
    name: str
    date_time: str | None = None
    location: str | None = None
    car_numbering_strategy: CarNumberingStrategy = CarNumberingStrategy.MANUAL
    global_start_number: int = 1
    championship_trophies: int = 3
    scoring_strategy: ScoringStrategy = ScoringStrategy.TIMED
    #: How a shared score is broken at a cut (#540). `SHARED` — not resolved —
    #: is the default; see `domain.tiebreak` for what each value does.
    tiebreaker: TiebreakMethod = TiebreakMethod.SHARED
    rules_configuration: str | None = None
    weight_limit_oz: float | None = None
    #: How many of each racer's worst counted results to drop before scoring
    #: (#547 stage 2) — a modifier over `scoring_strategy`, not a strategy of
    #: its own. `0` is the off state, matching the column's own default, so
    #: a race created with no opinion behaves exactly as one created before
    #: this field existed.
    drop_worst_runs: int = 0

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Race name cannot be empty or only whitespace")
        return v.strip()

    @field_validator("drop_worst_runs")
    @classmethod
    def drop_worst_runs_is_not_negative(cls, value: int) -> int:
        if value < 0:
            raise ValueError("drop_worst_runs cannot be negative")
        return value


class RaceCreate(RaceBase):
    organization_id: int
    track_id: int
    name: str
    date_time: str | None = None
    location: str | None = None


class RaceUpdate(BaseModel):
    name: str | None = None
    track_id: int | None = None
    date_time: str | None = None
    location: str | None = None
    scoring_strategy: ScoringStrategy | None = None
    #: Absent means leave alone, same as everything else on this update —
    #: `SHARED` is the non-null "off" state, the same shape `display_theme`'s
    #: `"MATCH_APP"` uses, so there is no separate clear flag to carry.
    tiebreaker: TiebreakMethod | None = None
    car_numbering_strategy: CarNumberingStrategy | None = None
    global_start_number: int | None = None
    championship_trophies: int | None = None
    auto_advance_heat: bool | None = None
    weight_limit_oz: float | None = None
    #: One interleaved running order across racing groups, rather than a
    #: block per group (#549 stage 2). Absent means leave alone, same as
    #: every other field here; `false` is an ordinary value, not a sentinel
    #: needing its own clear flag, since it is already what every race had
    #: before this column existed.
    master_running_order: bool | None = None
    #: Whether a phone with no PIN may vote right now (#305). An ordinary
    #: field on this update, not a separate mutation: `update_race` already
    #: drops absent fields, so a screen can send just this without touching
    #: anything else about the race.
    voting_open: bool | None = None
    #: A per-race override of the organization's terminology (#496 stage 3).
    #: Absent means leave alone; `schema.update_race` pops `clearTerminology`
    #: off the input before constructing this and, when set, fills these back
    #: in as explicit `None` — the same shape as `weight_limit_oz` above.
    racing_group_singular: str | None = None
    racing_group_plural: str | None = None
    organization_singular: str | None = None
    organization_plural: str | None = None
    #: A per-race override of the vehicle word (#551), same shape as the
    #: four fields above.
    vehicle_singular: str | None = None
    vehicle_plural: str | None = None
    #: A per-race override of the vehicle artwork (#551, stage 4), same
    #: shape as the six fields above.
    vehicle_artwork_key: str | None = None
    #: How many of each racer's worst counted results to drop before scoring
    #: (#547 stage 2). Absent means leave alone; `0` is the off state, so
    #: there is no separate clear flag — sending `0` back on is exactly how
    #: an operator turns it off, the same shape `master_running_order`'s
    #: `false` already uses.
    drop_worst_runs: int | None = None
    #: A decided championship round's winner(s) stop counting toward the
    #: standings of the round they qualified from (#548). Absent means leave
    #: alone; `false` is an ordinary value, not a sentinel — the same shape
    #: `master_running_order` and `voting_open` already use.
    exclude_round_winners_from_qualifying_standings: bool | None = None
    #: A per-race override of the organization's name-display default
    #: (#552). Absent means leave alone; `schema.update_race` pops
    #: `clearNameDisplay` off the input before constructing this and, when
    #: set, fills this back in as explicit `None` — unlike `weight_limit_oz`,
    #: because `"FULL"` here is a real value distinct from "inherit", the
    #: same reason `clearTerminology` exists.
    name_display: str | None = None
    #: Whether the race is locked against further edits (#585). Absent means
    #: leave alone, same as everything else on this update; `false` is an
    #: ordinary value (the unlock), not a sentinel needing its own clear
    #: flag — the same shape `master_running_order` and `voting_open` use.
    #: `api.race_lock.RaceLockExtension` is what actually enforces the lock;
    #: this column is read-write like any other field here.
    is_locked: bool | None = None
    #: At most one trophy per racer (#615) — a later award skips a racer who
    #: already holds an earlier one, so a den speed trophy rolls down to the
    #: next fastest car. Absent means leave alone, same as everything else on
    #: this update; `false` is an ordinary value, not a sentinel needing its
    #: own clear flag — the same shape `master_running_order` and
    #: `voting_open` already use.
    one_trophy_per_racer: bool | None = None

    @field_validator("drop_worst_runs")
    @classmethod
    def drop_worst_runs_is_not_negative(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("drop_worst_runs cannot be negative")
        return value


class OrganizationBase(BaseModel):
    name: str
    debug_mode: bool = False


class OrganizationCreate(OrganizationBase):
    pass


class HeatBase(BaseModel):
    heat_number: int
    lane_results: str | None = (
        None  # JSON string: [{"lane": 1, "racer_id": 10, "time": 3.45}, ...]
    )


class HeatCreate(HeatBase):
    race_id: int
    round_id: int


class AwardBase(BaseModel):
    """The stored shape of an award (#170).

    Half the fields belong to `SPEED` and half to `SPECIAL`; `crud` clears
    whichever half the kind does not use rather than trusting the caller to
    send a consistent row.
    """

    name: str
    kind: AwardKind = AwardKind.SPECIAL
    #: SPEED: `"ALL"` or `"ROUND:<id>"`, and 1-based `place`. Never
    #: `"EACH_GROUP"` — a racing-group-scoped award sets `racing_group_id`
    #: instead; see `domain/awards.py`.
    source: str | None = None
    place: int | None = None
    #: SPEED: which end `place` counts from. False is the fastest car, true the
    #: slowest — the same flip `Round.advancement_from_bottom` makes.
    from_bottom: bool = False
    racing_group_id: int | None = None
    #: SPECIAL: whoever a person decided, or nobody yet.
    racer_id: int | None = None
    #: Which clipart to show on the ceremony slide and the certificate (#306).
    #: Null prints a plain certificate. `crud` overwrites this for a `SPEED`
    #: award from its rule rather than trusting whatever a client sends — see
    #: `crud._set_speed_artwork_key` — so a value sent here only ever sticks
    #: for `SPECIAL`.
    artwork_key: str | None = None
    #: SPECIAL: whether this award takes ballots while the race's voting is
    #: open (#305). `crud._clear_fields_of_other_kind` forces this false for
    #: `SPEED`, the same way it forces `racer_id` null.
    votable: bool = False

    @field_validator("place")
    @classmethod
    def place_is_one_based(cls, value: int | None) -> int | None:
        """Refuse a place below 1 at the edge rather than at resolution time.

        `standings[place - 1]` with a place of 0 indexes from the end and hands
        the trophy to the slowest car, so this is worth catching where the
        number arrives.
        """
        if value is not None and value < 1:
            raise ValueError("place is 1-based; the winner is 1")
        return value


class AwardCreate(AwardBase):
    #: Omitted means "at the end of the running order".
    sort_order: int | None = None


class AwardUpdate(BaseModel):
    name: str | None = None
    kind: AwardKind | None = None
    source: str | None = None
    place: int | None = None
    from_bottom: bool | None = None
    racing_group_id: int | None = None
    racer_id: int | None = None
    artwork_key: str | None = None
    sort_order: int | None = None
    votable: bool | None = None

    @field_validator("place")
    @classmethod
    def place_is_one_based(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("place is 1-based; the winner is 1")
        return value
