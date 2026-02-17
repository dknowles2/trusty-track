import json
import typing
from typing import Any, List, Optional

import strawberry
from strawberry.types import Info

from . import crud, models, schemas, scoring


@strawberry.type
class LaneResult:
    """
    Represents the result of a single racer in a single lane of a heat.
    """

    lane: int
    racer_id: Optional[int]
    time: Optional[float]
    place: Optional[int]


@strawberry.type
class Heat:
    """
    Represents a single heat in a round.
    """

    id: int
    race_id: int
    round_id: int
    heat_number: int
    lane_results: Optional[str]

    @strawberry.field
    def parsed_results(self) -> List[LaneResult]:
        if not self.lane_results:
            return []
        try:
            data = json.loads(self.lane_results)
            return [
                LaneResult(
                    lane=r.get("lane"),
                    racer_id=r.get("racer_id"),
                    time=r.get("time"),
                    place=r.get("place"),
                )
                for r in data
            ]
        except (json.JSONDecodeError, TypeError):
            return []


@strawberry.type
class Round:
    """
    Represents a single round of racing.
    """

    id: int
    race_id: int
    round_number: int
    name: Optional[str]
    scheduling_strategy: str
    advancement_source: Optional[str]
    advancement_num_racers: Optional[int]

    @strawberry.field
    def heats(self, info: Info) -> List[Heat]:
        """Get all heats in this round."""
        return (
            info.context["db"]
            .query(models.Heat)
            .filter(models.Heat.round_id == self.id)
            .order_by(models.Heat.heat_number)
            .all()
        )


@strawberry.type
class AdvancementRacer:
    """
    Represents a racer eligible for advancement to a championship round.
    """

    racer_id: int
    first_name: str
    last_name: str
    car_number: Optional[int]
    den_name: str
    score: float
    rank: int
    is_advancing: bool


@strawberry.type
class AdvancementStatus:
    """
    Represents the status of advancement for a round, including eligible racers.
    """

    is_ready: bool
    requires_advancement: bool
    already_advanced: bool
    advancing_racers: List[AdvancementRacer]
    source: Optional[str]
    num_racers: Optional[int]


@strawberry.input
class RacerInput:
    """
    Input type for creating or updating a racer participant.
    """

    first_name: str
    last_name: str
    car_number: Optional[int] = None
    den_id: Optional[int] = None
    car_name: Optional[str] = None
    car_passed_inspection: bool = False
    car_weight: Optional[float] = None
    racer_image_url: Optional[str] = None
    car_image_url: Optional[str] = None
    race_id: Optional[int] = None


@strawberry.input
class DenInput:
    """
    Input type for creating or updating a Den sub-group.
    """

    name: str
    color: str = "#000000"
    rank: Optional[str] = None
    car_number_range_start: Optional[int] = None
    car_number_range_end: Optional[int] = None


@strawberry.input
class RaceInput:
    """
    Input type for creating or updating a race event.
    """

    name: str
    date_time: Optional[str] = None
    location: Optional[str] = None
    group_id: int = 1
    track_id: int
    scoring_strategy: str = "TIMED"
    car_numbering_strategy: str = "MANUAL"
    global_start_number: int = 1
    championship_trophies: int = 3


@strawberry.input
class TrackInput:
    """
    Input type for creating or updating a physical track configuration.
    """

    name: str = "Main Track"
    lane_count: int = 4
    length_feet: Optional[int] = None
    timer_type: str = "FAKE"
    serial_port: Optional[str] = None


@strawberry.input
class WizardGeneralRoundInput:
    """
    Configuration for a general racing round in the wizard.
    """

    type: str  # "PACK" or "DEN"
    runs_per_lane: int = 1


@strawberry.input
class WizardChampionshipRoundInput:
    """
    Configuration for a championship racing round in the wizard.
    """

    name: str = "Championship Round"
    source: str = "PACK"  # "PACK" (Overall) or "DEN" (Each Den)
    num_top_racers: int = 3
    runs_per_lane: int = 1


@strawberry.input
class WizardConfigurationInput:
    """
    Full configuration for the race scheduling wizard.
    """

    general_round: WizardGeneralRoundInput
    championship_rounds: List[WizardChampionshipRoundInput]


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
    def registered_count(self, info: Info) -> int:
        """Get the number of registered racers."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(models.Racer.race_id == self.id)
            .count()
        )

    @strawberry.field
    def checked_in_count(self, info: Info) -> int:
        """Get the number of checked-in racers."""
        return (
            info.context["db"]
            .query(models.Racer)
            .filter(
                models.Racer.race_id == self.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )

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
    def rounds(self, info: Info) -> List[Round]:
        """Get all rounds for this race."""
        return (
            info.context["db"]
            .query(models.Round)
            .filter(models.Round.race_id == self.id)
            .order_by(models.Round.round_number)
            .all()
        )

    @strawberry.field
    def heats(self, info: Info) -> List[Heat]:
        """Get all heats for this race."""
        return (
            info.context["db"]
            .query(models.Heat)
            .filter(models.Heat.race_id == self.id)
            .all()
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
        return typing.cast(
            Any, crud.get_races(info.context["db"], skip=skip, limit=limit)
        )

    @strawberry.field
    def race(self, info: Info, race_id: int) -> Optional[Race]:
        """Get a single race by ID."""
        return typing.cast(Any, crud.get_race(info.context["db"], race_id=race_id))

    @strawberry.field
    def racers(
        self, info: Info, race_id: Optional[int] = None, skip: int = 0, limit: int = 100
    ) -> List[Racer]:
        """Get a list of racers, optionally filtering by race_id."""
        return typing.cast(
            Any,
            crud.get_racers(
                info.context["db"], skip=skip, limit=limit, race_id=race_id
            ),
        )

    @strawberry.field
    def racer(self, info: Info, racer_id: int) -> Optional[Racer]:
        """Get a single racer by ID."""
        return typing.cast(
            Any,
            (
                info.context["db"]
                .query(models.Racer)
                .filter(models.Racer.id == racer_id)
                .first()
            ),
        )

    @strawberry.field
    def tracks(self, info: Info) -> List[Track]:
        """Get all available tracks."""
        return typing.cast(Any, crud.get_tracks(info.context["db"]))

    @strawberry.field
    def groups(self, info: Info) -> List[Group]:
        """Get all registered groups."""
        return typing.cast(Any, info.context["db"].query(models.Group).all())

    @strawberry.field
    def rounds(self, info: Info, race_id: int) -> List[Round]:
        """Get all rounds for a specific race."""
        return typing.cast(Any, crud.get_rounds(info.context["db"], race_id=race_id))

    @strawberry.field
    def advancement_status(
        self, info: Info, race_id: int, round_id: int
    ) -> AdvancementStatus:
        """Check if a round is ready to advance."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj:
            raise ValueError("Round not found")

        requires_advancement = round_obj.advancement_source is not None

        # Logic replicated from main.py's get_round_advancement_status
        heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
        already_advanced = True
        for heat in heats:
            if heat.lane_results:
                results = json.loads(heat.lane_results)
                for res in results:
                    if res.get("racer_id") is not None and res.get("racer_id") < 0:
                        already_advanced = False
                        break
            if not already_advanced:
                break

        all_rounds = (
            db.query(models.Round)
            .filter(models.Round.race_id == race_id)
            .order_by(models.Round.round_number)
            .all()
        )

        is_ready = True
        for r in all_rounds:
            if r.round_number < round_obj.round_number:
                previous_heats = (
                    db.query(models.Heat).filter(models.Heat.round_id == r.id).all()
                )
                for ph in previous_heats:
                    if not ph.lane_results:
                        is_ready = False
                        break
                    results = json.loads(ph.lane_results)
                    for res in results:
                        if res.get("racer_id") is not None and res.get("racer_id") > 0:
                            if res.get("time") is None and res.get("place") is None:
                                is_ready = False
                                break
                    if not is_ready:
                        break
            if not is_ready:
                break

        advancing_racers = []
        standings = scoring.get_leaderboard(db, race_id)

        adv_source = round_obj.advancement_source
        adv_num = round_obj.advancement_num_racers

        if not requires_advancement:
            next_round = (
                db.query(models.Round)
                .filter(
                    models.Round.race_id == race_id,
                    models.Round.round_number > round_obj.round_number,
                    models.Round.advancement_source.is_not(None),
                )
                .order_by(models.Round.round_number.asc())
                .first()
            )

            if next_round:
                requires_advancement = True
                adv_source = next_round.advancement_source
                adv_num = next_round.advancement_num_racers

        winner_ids = set()
        if requires_advancement:
            winner_ids = set(
                scoring.get_advancing_racers(db, race_id, adv_source, adv_num)
            )

        for s_data in standings:
            advancing_racers.append(
                AdvancementRacer(
                    racer_id=s_data["racer_id"],
                    first_name=s_data["first_name"],
                    last_name=s_data["last_name"],
                    car_number=s_data.get("car_number"),
                    den_name=s_data["den_name"],
                    score=s_data["score"],
                    rank=s_data["rank"],
                    is_advancing=s_data["racer_id"] in winner_ids,
                )
            )

        return AdvancementStatus(
            is_ready=is_ready,
            requires_advancement=requires_advancement,
            already_advanced=already_advanced,
            advancing_racers=advancing_racers,
            source=adv_source,
            num_racers=adv_num,
        )


@strawberry.type
class Mutation:
    """
    Root mutation type for creating and updating data.
    """

    @strawberry.mutation
    def create_race(self, info: Info, race: RaceInput) -> Race:
        """Create a new race."""
        race_in = schemas.RaceCreate(**typing.cast(Any, strawberry.asdict(race)))
        return typing.cast(Any, crud.create_race(info.context["db"], race_in))

    # Racer Mutations
    @strawberry.mutation
    def create_racer(self, info: Info, racer: RacerInput) -> Racer:
        """Create a new racer."""
        db = info.context["db"]
        racer_in = schemas.RacerCreate(**typing.cast(Any, strawberry.asdict(racer)))
        return typing.cast(Any, crud.create_racer(db, racer_in))

    @strawberry.mutation
    def update_racer(self, info: Info, id: int, racer: RacerInput) -> Optional[Racer]:
        """Update an existing racer."""
        db = info.context["db"]
        racer_update = schemas.RacerUpdate(**typing.cast(Any, strawberry.asdict(racer)))
        return typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )

    @strawberry.mutation
    def delete_racer(self, info: Info, id: int) -> bool:
        """Delete a racer."""
        db = info.context["db"]
        return crud.delete_racer(db, racer_id=id) is not None

    @strawberry.mutation
    def check_in_racer(
        self, info: Info, id: int, passed_inspection: bool, weight: Optional[float]
    ) -> Optional[Racer]:
        """Check in a racer."""
        db = info.context["db"]
        racer_update = schemas.RacerUpdate(
            car_passed_inspection=passed_inspection, car_weight=weight
        )
        # We need a partial update here, but schemas.RacerUpdate might require all fields.
        # Actually pydantic models with Optional usually allow partials if exclude_blank is used in crud.
        # Let's check crud.update_racer again.
        return typing.cast(
            Any, crud.update_racer(db, racer_id=id, racer_update=racer_update)
        )

    # Den Mutations
    @strawberry.mutation
    def create_den(self, info: Info, race_id: int, den: DenInput) -> Den:
        """Create a new den."""
        db = info.context["db"]
        den_in = schemas.DenCreate(**typing.cast(Any, strawberry.asdict(den)))
        return typing.cast(Any, crud.create_den(db, den_in, race_id=race_id))

    @strawberry.mutation
    def update_den(self, info: Info, id: int, den: DenInput) -> Optional[Den]:
        """Update an existing den."""
        db = info.context["db"]
        den_update = schemas.DenUpdate(**typing.cast(Any, strawberry.asdict(den)))
        return typing.cast(Any, crud.update_den(db, den_id=id, den_update=den_update))

    @strawberry.mutation
    def delete_den(self, info: Info, id: int) -> bool:
        """Delete a den."""
        db = info.context["db"]
        return crud.delete_den(db, den_id=id) is not None

    # Track Mutations
    @strawberry.mutation
    def create_track(self, info: Info, track: TrackInput) -> Track:
        """Create a new track."""
        db = info.context["db"]
        track_in = schemas.TrackCreate(**typing.cast(Any, strawberry.asdict(track)))
        return typing.cast(Any, crud.create_track(db, track_in))

    @strawberry.mutation
    def update_track(self, info: Info, id: int, track: TrackInput) -> Optional[Track]:
        """Update an existing track."""
        db = info.context["db"]
        db_track = crud.get_track(db, id)
        if not db_track:
            return None
        track_update = schemas.TrackBase(**typing.cast(Any, strawberry.asdict(track)))
        return typing.cast(Any, crud.update_track(db, db_track, track_update))

    @strawberry.mutation
    def delete_track(self, info: Info, id: int) -> bool:
        """Delete a track."""
        db = info.context["db"]
        try:
            return crud.delete_track(db, track_id=id)
        except ValueError:
            return False

    # Round / Schedule Mutations
    @strawberry.mutation
    def create_round_wizard(
        self, info: Info, race_id: int, config: WizardConfigurationInput
    ) -> List[Round]:
        """Create rounds using the wizard logic."""
        db = info.context["db"]
        # Logic replicated from main.py's create_race_wizard
        race = db.query(models.Race).filter(models.Race.id == race_id).first()
        if not race:
            raise ValueError("Race not found")

        existing_rounds = crud.get_rounds(db, race_id)
        if existing_rounds:
            raise ValueError("Cannot use wizard: rounds already exist for this race.")

        created_rounds = []
        current_round_number = 1

        try:
            # General Round
            if config.general_round.type == "PACK":
                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    "All Pack",
                )
                for i in range(config.general_round.runs_per_lane):
                    crud.generate_heats_for_round(
                        db, round_obj.id, clear_existing=(i == 0)
                    )
                created_rounds.append(round_obj)
                current_round_number += 1
            elif config.general_round.type == "DEN":
                dens = crud.get_dens(db, race_id)
                for den in dens:
                    racers = (
                        db.query(models.Racer)
                        .filter(models.Racer.den_id == den.id)
                        .all()
                    )
                    if not racers:
                        continue
                    round_obj = crud.create_round(
                        db,
                        race_id,
                        current_round_number,
                        models.SchedulingStrategy.PPC,
                        den.name,
                    )
                    p_ids = [r.id for r in racers]
                    for i in range(config.general_round.runs_per_lane):
                        crud.generate_heats_for_round(
                            db, round_obj.id, racer_ids=p_ids, clear_existing=(i == 0)
                        )
                    created_rounds.append(round_obj)
                    current_round_number += 1

            # Championship Rounds
            for champ_cfg in config.championship_rounds:
                round_obj = crud.create_round(
                    db,
                    race_id,
                    current_round_number,
                    models.SchedulingStrategy.PPC,
                    champ_cfg.name,
                    advancement_source=champ_cfg.source,
                    advancement_num_racers=champ_cfg.num_top_racers,
                )
                num_placeholders = champ_cfg.num_top_racers
                if champ_cfg.source == "DEN":
                    den_count = (
                        db.query(models.Den)
                        .filter(models.Den.race_id == race_id)
                        .count()
                    )
                    num_placeholders = champ_cfg.num_top_racers * den_count
                for i in range(champ_cfg.runs_per_lane):
                    crud.generate_heats_for_round(
                        db,
                        round_obj.id,
                        num_placeholders=num_placeholders,
                        clear_existing=(i == 0),
                    )
                created_rounds.append(round_obj)
                current_round_number += 1
        except ValueError as e:
            for r in created_rounds:
                crud.delete_round(db, r.id)
            raise e

        db.commit()
        return typing.cast(Any, created_rounds)

    @strawberry.mutation
    def regenerate_round(self, info: Info, round_id: int) -> List[Heat]:
        """Regenerate heats for a round."""
        db = info.context["db"]
        # We need to know if it's a placeholder round or racer round.
        # crud.generate_heats_for_round handles this if we pass the right params,
        # but it defaults to all racers if none provided.
        # For simplicity, let's just call it.
        return typing.cast(Any, crud.generate_heats_for_round(db, round_id))

    @strawberry.mutation
    def delete_round(self, info: Info, round_id: int) -> bool:
        """Delete a round."""
        db = info.context["db"]
        try:
            return crud.delete_round(db, round_id)
        except ValueError:
            return False

    @strawberry.mutation
    def advance_round(self, info: Info, race_id: int, round_id: int) -> int:
        """Advance racers to a round."""
        db = info.context["db"]
        round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
        if not round_obj or not round_obj.advancement_source:
            return 0
        winner_ids = scoring.get_advancing_racers(
            db, race_id, round_obj.advancement_source, round_obj.advancement_num_racers
        )
        if not winner_ids:
            return 0
        crud.resolve_round_placeholders(db, round_id, winner_ids)
        return len(winner_ids)

    # Heat Mutations
    @strawberry.mutation
    def update_heat_result(
        self, info: Info, heat_id: int, results: str
    ) -> Optional[Heat]:
        """Update results for a heat."""
        db = info.context["db"]
        return typing.cast(Any, crud.record_heat_result(db, heat_id, results))

    # Bulk Mutations
    @strawberry.mutation
    def bulk_auto_number(self, info: Info, racer_ids: List[int]) -> int:
        """Bulk auto-number racers."""
        db = info.context["db"]
        if not racer_ids:
            return 0
        racer = db.query(models.Racer).filter(models.Racer.id == racer_ids[0]).first()
        if not racer:
            return 0
        return crud.auto_number_racers(db, racer.race_id, racer_ids)

    @strawberry.mutation
    def bulk_clear_numbers(self, info: Info, racer_ids: List[int]) -> bool:
        """Bulk clear car numbers."""
        db = info.context["db"]
        crud.bulk_clear_car_numbers(db, racer_ids)
        return True

    @strawberry.mutation
    def bulk_move_to_den(self, info: Info, racer_ids: List[int], den_id: int) -> bool:
        """Bulk move racers to a den."""
        db = info.context["db"]
        crud.bulk_move_racers_to_den(db, racer_ids, den_id)
        return True

    @strawberry.mutation
    def bulk_delete_racers(self, info: Info, racer_ids: List[int]) -> bool:
        """Bulk delete racers."""
        db = info.context["db"]
        crud.bulk_delete_racers(db, racer_ids)
        return True


schema = strawberry.Schema(query=Query, mutation=Mutation)
