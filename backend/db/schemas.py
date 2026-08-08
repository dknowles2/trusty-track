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


class GroupBase(BaseModel):
    name: str
    debug_mode: bool = False


class GroupCreate(GroupBase):
    pass


class RoundUpdate(BaseModel):
    name: str | None = None


class HeatBase(BaseModel):
    heat_number: int
    lane_results: str | None = (
        None  # JSON string: [{"lane": 1, "racer_id": 10, "time": 3.45}, ...]
    )


class HeatCreate(HeatBase):
    race_id: int
    round_id: int
