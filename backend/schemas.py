from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from .models import TimerType, CarNumberingStrategy, Rank, SchedulingStrategy, ScoringStrategy

class TrackBase(BaseModel):
    lane_count: int = 4
    length_feet: Optional[int] = None
    timer_type: TimerType = TimerType.FAKE
    serial_port: Optional[str] = None

class PopulateTestDataRequest(BaseModel):
    count: int = 10

class DenBase(BaseModel):
    name: str
    color: str = "#000000"
    rank: Optional[Rank] = None
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None

class DenCreate(DenBase):
    pass

class DenUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    rank: Optional[Rank] = None
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None

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
    lane_count: int
    length_feet: Optional[int] = None
    timer_type: TimerType = TimerType.FAKE

class InitialConfigStatus(BaseModel):
    initialized: bool
    group_name: Optional[str] = None
    track_id: Optional[int] = None
    current_race_id: Optional[int] = None
    lane_count: Optional[int] = None
    length_feet: Optional[int] = None
    timer_type: Optional[str] = None

class RacerBase(BaseModel):
    first_name: str
    last_name: str
    car_number: Optional[int] = None
    den_id: Optional[int] = None
    car_name: Optional[str] = None
    car_passed_inspection: bool = False
    car_weight: Optional[float] = None
    racer_image_url: Optional[str] = None
    car_image_url: Optional[str] = None
    racing_group_id: Optional[int] = None

class RacerCreate(RacerBase):
    race_id: Optional[int] = None

class RacerUpdate(RacerBase):
    pass

class Racer(RacerBase):
    id: int
    race_id: int

    model_config = ConfigDict(from_attributes=True)

class RacingGroupBase(BaseModel):
    name: str
    den_id: Optional[int] = None
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None

class RacingGroupCreate(RacingGroupBase):
    pass

class RacingGroup(RacingGroupBase):
    id: int
    race_id: int
    racers: List[Racer] = []

    model_config = ConfigDict(from_attributes=True)

class RaceBase(BaseModel):
    name: str
    date_time: Optional[str] = None
    location: Optional[str] = None
    car_numbering_strategy: CarNumberingStrategy = CarNumberingStrategy.MANUAL
    global_start_number: int = 1
    championship_trophies: int = 3
    scoring_strategy: ScoringStrategy = ScoringStrategy.TIMED
    rules_configuration: Optional[str] = None

class RaceCreate(RaceBase):
    group_id: int
    name: str
    date_time: Optional[str] = None
    location: Optional[str] = None

class RaceUpdate(BaseModel):
    name: Optional[str] = None
    date_time: Optional[str] = None
    location: Optional[str] = None
    scoring_strategy: Optional[ScoringStrategy] = None
    car_numbering_strategy: Optional[CarNumberingStrategy] = None
    global_start_number: Optional[int] = None
    championship_trophies: Optional[int] = None

class Race(RaceBase):
    id: int
    group_id: Optional[int] = None
    racing_groups: List[RacingGroup] = []
    racers: List[Racer] = []

    model_config = ConfigDict(from_attributes=True)

class GroupBase(BaseModel):
    name: str

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    races: List[Race] = []

    model_config = ConfigDict(from_attributes=True)

class RoundBase(BaseModel):
    round_number: int = 1
    name: Optional[str] = None
    scheduling_strategy: SchedulingStrategy = SchedulingStrategy.PPC

class RoundCreate(RoundBase):
    race_id: int
    advancement_source: Optional[str] = None
    advancement_num_racers: Optional[int] = None
    runs_per_lane: int = 1
    general_type: str = "PACK" # Only used if advancement_source is None: "PACK" or "DEN"

class RoundUpdate(BaseModel):
    name: Optional[str] = None

class Round(RoundBase):
    id: int
    race_id: int
    advancement_source: Optional[str] = None
    advancement_num_racers: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class HeatBase(BaseModel):
    heat_number: int
    lane_results: Optional[str] = None # JSON string: [{"lane": 1, "racer_id": 10, "time": 3.45}, ...]

class HeatCreate(HeatBase):
    race_id: int
    round_id: int

class Heat(HeatBase):
    id: int
    race_id: int
    round_id: int
    round_number: int  # Computed from related Round
    round_name: Optional[str] = None # Computed from related Round
    advancement_num_racers: Optional[int] = None # Computed from related Round
    advancement_source: Optional[str] = None # Computed from related Round
    total_participants: int = 0 # Computed from related Round
    
    model_config = ConfigDict(from_attributes=True)

class HeatReorderItem(BaseModel):
    """Single heat reorder operation."""
    heat_id: int
    new_heat_number: int

class HeatReorderRequest(BaseModel):
    """Request to reorder multiple heats within a round."""
    heat_updates: List[HeatReorderItem]

class HeatReorderResponse(BaseModel):
    """Response after reordering heats."""
    updated_count: int
    heats: List[Heat]

class AdvancementRacer(BaseModel):
    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_name: str
    score: float
    rank: int

class AdvancementStatus(BaseModel):
    is_ready: bool
    requires_advancement: bool
    already_advanced: bool
    advancing_racers: List[AdvancementRacer] = []
    source: Optional[str] = None
    num_racers: Optional[int] = None

class WizardGeneralRound(BaseModel):
    type: str # "PACK" or "DEN"
    runs_per_lane: int = 1

class WizardChampionshipRound(BaseModel):
    name: str = "Championship Round"
    source: str = "PACK" # "PACK" (Overall) or "DEN" (Each Den)
    num_top_racers: int = 3
    runs_per_lane: int = 1

class WizardConfiguration(BaseModel):
    general_round: WizardGeneralRound
    championship_rounds: List[WizardChampionshipRound] = []
