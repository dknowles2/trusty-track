from pydantic import BaseModel, ConfigDict, field_validator

from .models import (
    CarNumberingStrategy,
    Rank,
    SchedulingStrategy,
    ScoringStrategy,
    TimerType,
)


class TrackBase(BaseModel):
    name: str = "Main Track"
    lane_count: int = 4
    length_feet: int | None = None
    timer_type: TimerType = TimerType.FAKE
    serial_port: str | None = None


class PopulateTestDataRequest(BaseModel):
    count: int = 10
    add_racer_photos: bool = True
    add_car_photos: bool = True
    assign_dens: bool = True
    check_in: bool = False


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


class Den(DenBase):
    id: int
    race_id: int

    model_config = ConfigDict(from_attributes=True)


class TrackCreate(TrackBase):
    pass


class Track(TrackBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class InitialConfigCreate(BaseModel):
    group_name: str
    debug_mode: bool = False
    tracks: list[TrackCreate]


class InitialConfigStatus(BaseModel):
    initialized: bool
    group_name: str | None = None
    debug_mode: bool = False
    tracks: list[Track] = []
    current_race_id: int | None = None


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
    racing_group_id: int | None = None


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
    racing_group_id: int | None = None


class Racer(RacerBase):
    id: int
    race_id: int

    model_config = ConfigDict(from_attributes=True)


class RacingGroupBase(BaseModel):
    name: str
    den_id: int | None = None
    car_number_range_start: int | None = None
    car_number_range_end: int | None = None


class RacingGroupCreate(RacingGroupBase):
    pass


class RacingGroup(RacingGroupBase):
    id: int
    race_id: int
    racers: list[Racer] = []

    model_config = ConfigDict(from_attributes=True)


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


class Race(RaceBase):
    id: int
    group_id: int
    track_id: int
    racing_groups: list[RacingGroup] = []
    racers: list[Racer] = []
    registered_count: int = 0
    checked_in_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class GroupBase(BaseModel):
    name: str
    debug_mode: bool = False


class GroupCreate(GroupBase):
    pass


class Group(GroupBase):
    id: int
    races: list[Race] = []

    model_config = ConfigDict(from_attributes=True)


class RoundBase(BaseModel):
    round_number: int = 1
    name: str | None = None
    scheduling_strategy: SchedulingStrategy = SchedulingStrategy.PPC
    den_id: int | None = None


class RoundCreate(RoundBase):
    race_id: int
    advancement_source: str | None = None
    advancement_num_racers: int | None = None
    runs_per_lane: int = 1
    general_type: str = (
        "PACK"  # Only used if advancement_source is None: "PACK" or "DEN"
    )


class RoundUpdate(BaseModel):
    name: str | None = None


class Round(RoundBase):
    id: int
    race_id: int
    advancement_source: str | None = None
    advancement_num_racers: int | None = None

    model_config = ConfigDict(from_attributes=True)


class HeatBase(BaseModel):
    heat_number: int
    lane_results: str | None = (
        None  # JSON string: [{"lane": 1, "racer_id": 10, "time": 3.45}, ...]
    )


class HeatCreate(HeatBase):
    race_id: int
    round_id: int


class Heat(HeatBase):
    id: int
    race_id: int
    round_id: int
    round_number: int  # Computed from related Round
    round_name: str | None = None  # Computed from related Round
    advancement_num_racers: int | None = None  # Computed from related Round
    advancement_source: str | None = None  # Computed from related Round
    total_participants: int = 0  # Computed from related Round

    model_config = ConfigDict(from_attributes=True)


class HeatReorderItem(BaseModel):
    """Single heat reorder operation."""

    heat_id: int
    new_heat_number: int


class HeatReorderRequest(BaseModel):
    """Request to reorder multiple heats within a round."""

    heat_updates: list[HeatReorderItem]


class HeatReorderResponse(BaseModel):
    """Response after reordering heats."""

    updated_count: int
    heats: list[Heat]


class AdvancementRacer(BaseModel):
    racer_id: int
    first_name: str
    last_name: str
    car_number: int | None
    den_name: str
    score: float
    rank: int
    is_advancing: bool = False


class AdvancementStatus(BaseModel):
    is_ready: bool
    requires_advancement: bool
    already_advanced: bool
    advancing_racers: list[AdvancementRacer] = []
    source: str | None = None
    num_racers: int | None = None


class WizardGeneralRound(BaseModel):
    type: str  # "PACK" or "DEN"
    runs_per_lane: int = 1


class WizardChampionshipRound(BaseModel):
    name: str = "Championship Round"
    source: str = "PACK"  # "PACK" (Overall) or "DEN" (Each Den)
    num_top_racers: int = 3
    runs_per_lane: int = 1


class WizardConfiguration(BaseModel):
    general_round: WizardGeneralRound
    championship_rounds: list[WizardChampionshipRound] = []


class BulkRacerActionRequest(BaseModel):
    racer_ids: list[int]


class BulkRacerMoveRequest(BulkRacerActionRequest):
    den_id: int | None = None
