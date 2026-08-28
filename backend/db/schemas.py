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

from .models import (
    AwardKind,
    CarNumberingStrategy,
    Rank,
    ScoringStrategy,
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


class DenBase(BaseModel):
    name: str
    color: str = "#000000"
    rank: Rank | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


class DenCreate(DenBase):
    pass


class DenUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    rank: Rank | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


class TrackCreate(TrackBase):
    pass


class InitialConfigCreate(BaseModel):
    group_name: str
    debug_mode: bool = False
    tracks: list[TrackCreate]
    # Accepted and ignored here: the PINs are hashed in `schema._apply_pins`
    # rather than carried through `crud`, so a plaintext PIN never reaches a
    # persistence helper. Declared so `strawberry.asdict(config)` can be handed
    # over whole without the extra keys raising.
    operator_pin: str | None = None
    checkin_pin: str | None = None


class RacerBase(BaseModel):
    first_name: str
    last_name: str
    car_number: int | None = None
    den_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool = False
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None


class RacerCreate(RacerBase):
    race_id: int | None = None


class RacerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    car_number: int | None = None
    den_id: int | None = None
    car_name: str | None = None
    car_passed_inspection: bool | None = None
    car_weight: float | None = None
    racer_image_url: str | None = None
    car_image_url: str | None = None


class RaceBase(BaseModel):
    name: str
    date_time: str | None = None
    location: str | None = None
    car_numbering_strategy: CarNumberingStrategy = CarNumberingStrategy.MANUAL
    global_start_number: int = 1
    championship_trophies: int = 3
    scoring_strategy: ScoringStrategy = ScoringStrategy.TIMED
    rules_configuration: str | None = None
    weight_limit_oz: float | None = None

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Race name cannot be empty or only whitespace")
        return v.strip()


class RaceCreate(RaceBase):
    group_id: int
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
    car_numbering_strategy: CarNumberingStrategy | None = None
    global_start_number: int | None = None
    championship_trophies: int | None = None
    auto_advance_heat: bool | None = None
    weight_limit_oz: float | None = None


class GroupBase(BaseModel):
    name: str
    debug_mode: bool = False


class GroupCreate(GroupBase):
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
    #: SPEED: `"PACK"` or `"ROUND:<id>"`, and 1-based `place`. Never `"DEN"` —
    #: a den-scoped award sets `den_id` instead; see `domain/awards.py`.
    source: str | None = None
    place: int | None = None
    #: SPEED: which end `place` counts from. False is the fastest car, true the
    #: slowest — the same flip `Round.advancement_from_bottom` makes.
    from_bottom: bool = False
    den_id: int | None = None
    #: SPECIAL: whoever a person decided, or nobody yet.
    racer_id: int | None = None
    #: Which clipart to show on the ceremony slide and the certificate (#306).
    #: Null prints a plain certificate. `crud` overwrites this for a `SPEED`
    #: award from its rule rather than trusting whatever a client sends — see
    #: `crud._set_speed_artwork_key` — so a value sent here only ever sticks
    #: for `SPECIAL`.
    artwork_key: str | None = None

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
    den_id: int | None = None
    racer_id: int | None = None
    artwork_key: str | None = None
    sort_order: int | None = None

    @field_validator("place")
    @classmethod
    def place_is_one_based(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("place is 1-based; the winner is 1")
        return value
