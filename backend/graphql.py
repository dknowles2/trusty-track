import typing
from typing import List, Optional

import strawberry
from sqlalchemy.orm import selectinload
from strawberry.types import Info

from . import crud, models, schemas
from .database import SessionLocal


@strawberry.type
class Den:
    """
    Represents a Den (sub-group of racers), usually corresponding to a rank or age group.
    """

    id: int
    name: str
    color: str
    rank: Optional[str]
    race_id: int
    car_number_range_start: Optional[int]
    car_number_range_end: Optional[int]

    @strawberry.field
    def racers(self, info: Info) -> List["Racer"]:
        """Get all racers belonging to this den."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.den_id == self.id)
            .all()
        )


@strawberry.type
class Racer:
    """
    Represents a single racer participant in the event.
    """

    id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    car_name: Optional[str]
    car_passed_inspection: bool
    car_weight: Optional[float]
    racer_image_url: Optional[str]
    car_image_url: Optional[str]
    den_id: Optional[int]
    race_id: int

    @strawberry.field
    def den(self, info: Info) -> Optional[Den]:
        """Get the den this racer belongs to, if any."""
        if not self.den_id:
            return None
        return (
            info.context["db"]
            .query(models.Den)
            .filter(models.Den.id == self.den_id)
            .first()
        )


@strawberry.type
class Race:
    """
    Represents a Race event, which contains multiple racers, dens, and rounds.
    """

    id: int
    name: str
    date_time: Optional[str]
    location: Optional[str]
    group_id: int
    track_id: Optional[int]
    car_numbering_strategy: str
    global_start_number: int
    championship_trophies: int
    scoring_strategy: str

    @strawberry.field
    def dens(self, info: Info) -> List[Den]:
        """Get all dens associated with this race."""
        return (
            info.context["db"]
            .query(models.Den)
            .filter(models.Den.race_id == self.id)
            .all()
        )

    @strawberry.field
    def racers(self, info: Info) -> List[Racer]:
        """Get all racers registered for this race."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.race_id == self.id)
            .all()
        )

    @strawberry.field
    def group(self, info: Info) -> "Group":
        """Get the organization group that owns this race."""
        return (
            info.context["db"]
            .query(models.Group)
            .filter(models.Group.id == self.group_id)
            .first()
        )

    @strawberry.field
    def track(self, info: Info) -> Optional["Track"]:
        """Get the track configuration used for this race."""
        if not self.track_id:
            return None
        return (
            info.context["db"]
            .query(models.Track)
            .filter(models.Track.id == self.track_id)
            .first()
        )


@strawberry.type
class Track:
    """
    Represents a physical track configuration (lanes, timer hardware, etc.).
    """

    id: int
    name: str
    lane_count: int
    length_feet: Optional[int]
    timer_type: str
    serial_port: Optional[str]

    @strawberry.field
    def races(self, info: Info) -> List[Race]:
        """Get all races that have used this track."""
        return (
            info.context["db"]
            .query(models.Race)
            .filter(models.Race.track_id == self.id)
            .all()
        )


@strawberry.type
class Group:
    """
    Represents an organization or group (e.g. 'Pack 123') that holds races.
    """

    id: int
    name: str

    @strawberry.field
    def races(self, info: Info) -> List[Race]:
        """Get all races organized by this group."""
        return (
            info.context["db"]
            .query(models.Race)
            .filter(models.Race.group_id == self.id)
            .all()
        )


@strawberry.type
class Query:
    """
    Root query type for fetching data.
    """

    @strawberry.field
    def races(self, info: Info, skip: int = 0, limit: int = 100) -> List[Race]:
        """Get a list of races with pagination."""
        return crud.get_races(info.context["db"], skip=skip, limit=limit)

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Optional[Race]:
        """Get a single race by ID."""
        return crud.get_race(info.context["db"], race_id=race_id)

    @strawberry.field
    def racers(
        self, info: Info, race_id: Optional[int] = None, skip: int = 0, limit: int = 100
    ) -> List[Racer]:
        """Get a list of racers, optionally filtering by race_id."""
        return crud.get_racers(
            info.context["db"], skip=skip, limit=limit, race_id=race_id
        )

    @strawberry.field
    def racer(self, info: Info, racer_id: int) -> Optional[Racer]:
        """Get a single racer by ID."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.id == racer_id)
            .first()
        )

    @strawberry.field
    def tracks(self, info: Info) -> List[Track]:
        """Get all available tracks."""
        return crud.get_tracks(info.context["db"])

    @strawberry.field
    def groups(self, info: Info) -> List[Group]:
        """Get all registered groups."""
        return info.context["db"].query(models.Group).all()


@strawberry.type
class Mutation:
    """
    Root mutation type for creating and updating data.
    """

    @strawberry.mutation
    def create_race(self, info: Info, name: str, group_id: int, track_id: int) -> Race:
        """Create a new race."""
        race_in = schemas.RaceCreate(name=name, group_id=group_id, track_id=track_id)
        return crud.create_race(info.context["db"], race_in)


schema = strawberry.Schema(query=Query, mutation=Mutation)
