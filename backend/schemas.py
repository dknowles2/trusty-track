from typing import List, Optional
from pydantic import BaseModel
from .models import TimerType, CarNumberingStrategy, Rank, SchedulingStrategy, ScoringStrategy

class TrackBase(BaseModel):
    lane_count: int = 4
    length_feet: Optional[int] = None
    timer_type: TimerType = TimerType.SKIP
    serial_port: Optional[str] = None

class TrackCreate(TrackBase):
    pass

class Track(TrackBase):
    id: int
    
    class Config:
        orm_mode = True

class InitialConfigCreate(BaseModel):
    group_name: str
    lane_count: int
    length_feet: Optional[int] = None
    timer_type: TimerType = TimerType.SKIP

class InitialConfigStatus(BaseModel):
    initialized: bool
    group_name: Optional[str] = None
    track_id: Optional[int] = None

class RacerBase(BaseModel):
    first_name: str
    last_name: str
    car_number: int
    car_name: Optional[str] = None
    car_passed_inspection: bool = False
    racer_image_url: Optional[str] = None
    car_image_url: Optional[str] = None
    racing_group_id: Optional[int] = None

class RacerCreate(RacerBase):
    pass

class Racer(RacerBase):
    id: int
    race_id: int

    class Config:
        orm_mode = True

class RacingGroupBase(BaseModel):
    name: str
    rank: Rank = Rank.OTHER
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None

class RacingGroupCreate(RacingGroupBase):
    pass

class RacingGroup(RacingGroupBase):
    id: int
    race_id: int
    racers: List[Racer] = []

    class Config:
        orm_mode = True

class RaceBase(BaseModel):
    name: str
    date_time: Optional[str] = None
    location: Optional[str] = None
    car_numbering_strategy: CarNumberingStrategy = CarNumberingStrategy.MANUAL
    global_start_number: int = 1
    scheduling_strategy: SchedulingStrategy = SchedulingStrategy.LANE_ROTATION
    scoring_strategy: ScoringStrategy = ScoringStrategy.TIMED
    rules_configuration: Optional[str] = None

class RaceCreate(RaceBase):
    group_id: int

class Race(RaceBase):
    id: int
    group_id: int
    racing_groups: List[RacingGroup] = []
    racers: List[Racer] = []

    class Config:
        orm_mode = True

class GroupBase(BaseModel):
    name: str

class GroupCreate(GroupBase):
    pass

class Group(GroupBase):
    id: int
    races: List[Race] = []

    class Config:
        orm_mode = True
