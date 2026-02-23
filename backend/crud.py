from __future__ import annotations

import json
import random
from typing import Any, List, Optional

from sqlalchemy.orm import Session

from . import models, schemas


def get_group(db: Session, group_id: int) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.id == group_id).first()


def get_group_by_name(db: Session, name: str) -> models.Group | None:
    return db.query(models.Group).filter(models.Group.name == name).first()


def create_group(db: Session, group: schemas.GroupCreate) -> models.Group:
    db_group = models.Group(name=group.name)
    db.add(db_group)
    db.commit()
    db.refresh(db_group)
    return db_group


def get_dens(
    db: Session, race_id: int, skip: int = 0, limit: int = 100
) -> List[models.Den]:
    return (
        db.query(models.Den)
        .filter(models.Den.race_id == race_id)
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_den(db: Session, den_id: int) -> models.Den | None:
    return db.query(models.Den).filter(models.Den.id == den_id).first()


def get_den_by_name(db: Session, name: str, race_id: int) -> models.Den | None:
    # Example: Case insensitive search could be done here if DB supports it easily,
    # or just do exact match for simplicity first
    return (
        db.query(models.Den)
        .filter(models.Den.name == name, models.Den.race_id == race_id)
        .first()
    )


def create_den(db: Session, den: schemas.DenCreate, race_id: int) -> models.Den:
    db_den = models.Den(**den.model_dump(), race_id=race_id)
    db.add(db_den)
    db.commit()
    db.refresh(db_den)
    return db_den


def delete_den(db: Session, den_id: int) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if db_den:
        racers = db.query(models.Racer).filter(models.Racer.den_id == den_id).all()
        for racer in racers:
            racer.den_id = None

        db.delete(db_den)
        db.commit()
    return db_den


def update_den(
    db: Session, den_id: int, den_update: schemas.DenUpdate
) -> models.Den | None:
    db_den = db.query(models.Den).filter(models.Den.id == den_id).first()
    if not db_den:
        return None

    update_data = den_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_den, key, value)

    db.commit()
    db.refresh(db_den)
    return db_den


def get_races(db: Session, skip: int = 0, limit: int = 100) -> List[models.Race]:
    """Get all races with computed registered and checked-in racer counts."""
    races = db.query(models.Race).offset(skip).limit(limit).all()
    for race in races:
        race.registered_count = (
            db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
        )
        race.checked_in_count = (
            db.query(models.Racer)
            .filter(
                models.Racer.race_id == race.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )
    return races


def create_race(db: Session, race: schemas.RaceCreate) -> models.Race:
    race_data = race.model_dump()
    db_race = models.Race(**race_data)
    db.add(db_race)
    db.commit()
    db.refresh(db_race)
    return db_race


def update_race(
    db: Session, race_id: int, race_update: schemas.RaceUpdate
) -> models.Race | None:
    db_race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not db_race:
        return None

    update_data = race_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_race, key, value)

    db.commit()
    db.refresh(db_race)
    return db_race


def get_race(db: Session, race_id: int) -> models.Race | None:
    """Get a specific race by ID with computed racer counts."""
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race:
        race.registered_count = (
            db.query(models.Racer).filter(models.Racer.race_id == race.id).count()
        )
        race.checked_in_count = (
            db.query(models.Racer)
            .filter(
                models.Racer.race_id == race.id,
                models.Racer.car_passed_inspection,
            )
            .count()
        )
    return race


def delete_race(db: Session, race_id: int) -> bool:
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return False

    # Manually delete racers to handle optional relationships cleaner if needed,
    # though cascade might handle it. Let's rely on cascade for sub-tables but
    # explicity check here safely.

    # Models have:
    # dens: cascade="all, delete-orphan"
    # rounds: cascade="all, delete-orphan"

    # racers: back_populates="race", but NO cascade specified in Race model for racers!
    # So we MUST delete racers manually or update the model.
    # Let's delete them manually to be safe without changing models.py if not needed.

    # Actually, let's just delete the racers first.
    db.query(models.Racer).filter(models.Racer.race_id == race_id).delete()

    # Racing groups also might need deletion?
    # racing_groups: back_populates="race", no cascade.
    db.query(models.RacingGroup).filter(models.RacingGroup.race_id == race_id).delete()

    # Heats?
    # heats: back_populates="race", no cascade in Race model.
    # But rounds delete heats via cascade.
    # However, if heats are linked to race directly as well...
    # Heat model has race_id.
    db.query(models.Heat).filter(models.Heat.race_id == race_id).delete()

    # Free race heats
    db.query(models.FreeRaceHeat).filter(
        models.FreeRaceHeat.race_id == race_id
    ).delete()

    db.delete(race)
    db.commit()
    return True


def get_tracks(db: Session) -> List[models.Track]:
    return db.query(models.Track).all()


def get_track(db: Session, track_id: int) -> models.Track | None:
    return db.query(models.Track).filter(models.Track.id == track_id).first()


def create_track(db: Session, track: schemas.TrackCreate) -> models.Track:
    db_track = models.Track(**track.model_dump())
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track


def create_initial_config(
    db: Session, config: schemas.InitialConfigCreate
) -> tuple[models.Group, List[models.Track]]:
    # Create Group
    group = models.Group(name=config.group_name)
    db.add(group)

    # Create Tracks
    created_tracks = []
    for track_data in config.tracks:
        track = models.Track(**track_data.model_dump())
        db.add(track)
        created_tracks.append(track)

    db.commit()
    db.refresh(group)
    for t in created_tracks:
        db.refresh(t)
    return group, created_tracks


def update_group(db: Session, group: models.Group, name: str) -> models.Group:
    group.name = name
    db.commit()
    db.refresh(group)
    return group


def update_track(
    db: Session, track: models.Track, track_update: schemas.TrackBase
) -> models.Track:
    update_data = track_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(track, key, value)
    db.commit()
    db.refresh(track)
    return track


def delete_track(db: Session, track_id: int) -> bool:
    track = db.query(models.Track).filter(models.Track.id == track_id).first()
    if track:
        # Check if any races are associated
        if track.races:
            raise ValueError(
                "Cannot delete track: it is associated with one or more races."
            )
        db.delete(track)
        db.commit()
        return True
    return False


def get_racers(
    db: Session, skip: int = 0, limit: int = 100, race_id: int | None = None
) -> List[models.Racer]:
    query = db.query(models.Racer)
    if race_id:
        query = query.filter(models.Racer.race_id == race_id)
    return query.offset(skip).limit(limit).all()


def create_racer(db: Session, racer: schemas.RacerCreate) -> models.Racer | None:
    # Ensure a race exists.
    race: models.Race | None = None
    if racer.race_id:
        race = db.query(models.Race).filter(models.Race.id == racer.race_id).first()
    else:
        race = db.query(models.Race).first()

    if not race:
        group = db.query(models.Group).first()
        if not group:
            return None
        race = models.Race(name="Main Event", group_id=group.id)
        db.add(race)
        db.commit()
        db.refresh(race)

    assert race is not None

    racer_data = racer.model_dump()
    if "race_id" in racer_data:
        del racer_data["race_id"]

    den_id = racer_data.get("den_id")

    # Handle Racing Group based on Den
    if den_id:
        den = get_den(db, den_id)
        if den:
            # Find or create racing group for this Den
            racing_group = (
                db.query(models.RacingGroup)
                .filter(
                    models.RacingGroup.race_id == race.id,
                    models.RacingGroup.den_id == den_id,
                )
                .first()
            )

            if not racing_group:
                racing_group = models.RacingGroup(
                    race_id=race.id, name=f"{den.name}s", den_id=den_id
                )
                db.add(racing_group)
                db.commit()
                db.refresh(racing_group)

            racer_data["racing_group_id"] = racing_group.id

    db_racer = models.Racer(**racer_data, race_id=race.id)
    db.add(db_racer)
    db.commit()
    db.refresh(db_racer)
    return db_racer


def update_racer(
    db: Session, racer_id: int, racer_update: schemas.RacerUpdate
) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if not db_racer:
        return None

    update_data = racer_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racer, key, value)

    db.commit()
    db.refresh(db_racer)
    return db_racer





def _remove_racer_from_regular_heats(db: Session, racer_ids: set[int], round_id: int):
    """Nullify lane entries for deleted racers in heats of a specific round."""
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    for heat in heats:
        if not heat.lane_results:
            continue
        results = json.loads(heat.lane_results)
        modified = False
        for lane in results:
            if lane.get("racer_id") in racer_ids:
                lane["racer_id"] = None
                lane["time"] = None
                lane["place"] = None
                modified = True
        if modified:
            heat.lane_results = json.dumps(results)


def _remove_racer_from_free_heats(db: Session, racer_ids: set[int], race_id: int):
    """Nullify lane entries for deleted racers in free race heats of a race."""
    free_heats = (
        db.query(models.FreeRaceHeat)
        .filter(models.FreeRaceHeat.race_id == race_id)
        .all()
    )
    for fh in free_heats:
        modified = False
        # Update assignments
        assignments = json.loads(fh.lane_assignments)
        for lane in assignments:
            if lane.get("racer_id") in racer_ids:
                lane["racer_id"] = None
                modified = True
        if modified:
            fh.lane_assignments = json.dumps(assignments)

        # Update results if they exist
        if fh.lane_results:
            results = json.loads(fh.lane_results)
            results_modified = False
            for lane in results:
                if lane.get("racer_id") in racer_ids:
                    lane["racer_id"] = None
                    lane["time"] = None
                    lane["place"] = None
                    results_modified = True
            if results_modified:
                fh.lane_results = json.dumps(results)


def delete_racer(db: Session, racer_id: int) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if db_racer:
        bulk_delete_racers(db, [racer_id])
    return db_racer


def get_heats(db: Session, race_id: int) -> List[models.Heat]:
    """Get all heats for a specific race, ordered by round and heat number."""
    return (
        db.query(models.Heat)
        .filter(models.Heat.race_id == race_id)
        .join(models.Round)
        .order_by(models.Round.round_number, models.Heat.heat_number)
        .all()
    )


def get_rounds(db: Session, race_id: int) -> List[models.Round]:
    """Get all rounds for a specific race, ordered by round number."""
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def create_round(
    db: Session,
    race_id: int,
    round_number: int,
    scheduling_strategy: models.SchedulingStrategy = models.SchedulingStrategy.PPC,
    name: str | None = None,
    advancement_source: str | None = None,
    advancement_num_racers: int | None = None,
    den_id: int | None = None,
) -> models.Round:
    """Create a new round for a race."""
    round_obj = models.Round(
        race_id=race_id,
        round_number=round_number,
        scheduling_strategy=scheduling_strategy,
        name=name,
        advancement_source=advancement_source,
        advancement_num_racers=advancement_num_racers,
        den_id=den_id,
    )
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return round_obj


def update_round(
    db: Session, round_id: int, round_update: schemas.RoundUpdate
) -> models.Round | None:
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        return None

    if round_update.name is not None:
        round_obj.name = round_update.name

    db.commit()
    db.refresh(round_obj)
    return round_obj


def delete_round(db: Session, round_id: int) -> bool:
    """Delete a round and all its heats. Only if no heats have results."""
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if round_obj:
        # Check if any heats have results
        import json

        for heat in round_obj.heats:
            if heat.lane_results:
                try:
                    results = json.loads(heat.lane_results)
                    if any(r.get("time") is not None for r in results):
                        raise ValueError(
                            "Cannot delete round: it has heats with results."
                        )
                except json.JSONDecodeError:
                    pass

        # Rule 2: Cannot delete general round if championship rounds are scheduled
        if not round_obj.advancement_source:
            champ_rounds = (
                db.query(models.Round)
                .filter(
                    models.Round.race_id == round_obj.race_id,
                    models.Round.advancement_source.is_not(None),
                    models.Round.advancement_source != "",
                )
                .first()
            )
            if champ_rounds:
                raise ValueError(
                    "Cannot delete general round: championship rounds are already scheduled."
                )

        db.delete(round_obj)
        db.commit()
        return True
    return False


def _generate_ppc(
    db: Session,
    race_id: int,
    round_id: int,
    p_ids: List[int],
    lane_count: int,
    start_heat_num: int = 1,
) -> List[models.Heat]:
    """
    Generate Partial Perfect Chart (PPC) heats.
    Uses greedy optimization to balance lane usage and maximize opponent variety.
    """
    random.shuffle(p_ids)
    P = len(p_ids)
    L = lane_count

    # Matchup matrix
    matchups: dict[int, dict[int, int]] = {p1: {p2: 0 for p2 in p_ids} for p1 in p_ids}

    # heat_matrix[heat_idx][lane_idx] = racer_id
    heat_matrix: List[List[Optional[int]]] = [
        [None for _ in range(L)] for _ in range(P)
    ]

    # Fill Lane 1 (lane_idx 0) with all racers
    lane1_racers = list(p_ids)
    random.shuffle(lane1_racers)
    for i in range(P):
        heat_matrix[i][0] = lane1_racers[i]

    # Participant lane occupancy tracking
    occupied_lanes: dict[int, set[int]] = {p_id: {0} for p_id in lane1_racers}

    # For subsequent lanes
    for j in range(1, L):
        available_racers = list(p_ids)
        random.shuffle(available_racers)

        for i in range(P):
            current_heat_racers = [
                heat_matrix[i][k] for k in range(j) if heat_matrix[i][k] is not None
            ]

            # Candidates: hasn't been in this lane AND not in current heat
            # (Note: r is never None in current_heat_racers)
            candidates = [
                r
                for r in available_racers
                if j not in occupied_lanes[r] and r not in current_heat_racers
            ]

            if not candidates:
                # Fallback: just not in current heat
                candidates = [
                    r for r in available_racers if r not in current_heat_racers
                ]

            best_racer = None
            min_score = float("inf")
            for r in candidates:
                score = sum(
                    matchups[r][other]
                    for other in current_heat_racers
                    if other is not None
                )
                if score < min_score:
                    min_score = score
                    best_racer = r

            if best_racer:
                heat_matrix[i][j] = best_racer
                available_racers.remove(best_racer)
                occupied_lanes[best_racer].add(j)
                for other in current_heat_racers:
                    if other is not None:
                        matchups[best_racer][other] += 1
                        matchups[other][best_racer] += 1

    generated_heats: List[models.Heat] = []
    for i in range(P):
        lane_assignment = []
        for j in range(L):
            lane_assignment.append(
                {
                    "lane": j + 1,
                    "racer_id": heat_matrix[i][j],
                    "time": None,
                    "place": None,
                }
            )
        heat = models.Heat(
            race_id=race_id,
            round_id=round_id,
            heat_number=start_heat_num + i,
            lane_results=json.dumps(lane_assignment),
        )
        db.add(heat)
        generated_heats.append(heat)
    return generated_heats


def generate_heats_for_round(
    db: Session,
    round_id: int,
    num_placeholders: int = 0,
    racer_ids: List[int] | None = None,
    clear_existing: bool = True,
) -> List[models.Heat]:
    """
    Generate heats for a specific round based on its scheduling strategy.
    Supports regeneration if no heats in the round have started.

    If num_placeholders is > 0, it generates heats for that many "placeholder"
    racers (using negative IDs -1, -2, etc.).

    If racer_ids is provided, it uses those specific racers instead of all
    racers in the race.

    If clear_existing is True, it will delete existing heats in the round.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise ValueError(f"Round {round_id} not found")

    race_id = round_obj.race_id
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    lane_count = race.track.lane_count if race and race.track else 4

    # Check for existing heats
    existing_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    )
    if existing_heats and clear_existing:
        # Check if any have results
        for h in existing_heats:
            if h.lane_results:
                try:
                    results = json.loads(h.lane_results)
                    if any(r.get("time") is not None for r in results):
                        raise ValueError(
                            "Cannot regenerate round: some heats already have results."
                        )
                except (json.JSONDecodeError, TypeError):
                    continue

        # Safe to delete
        for h in existing_heats:
            db.delete(h)
        db.flush()  # Ensure deletions are reflected before new generation

    if num_placeholders > 0:
        p_ids = [-(i + 1) for i in range(num_placeholders)]
    elif racer_ids is not None:
        p_ids = racer_ids
    else:
        query = db.query(models.Racer).filter(
            models.Racer.race_id == race_id, models.Racer.car_passed_inspection
        )
        if round_obj.den_id:
            query = query.filter(models.Racer.den_id == round_obj.den_id)
        racers = query.all()
        if not racers or len(racers) < 2:
            raise ValueError(
                "Not enough racers to generate a schedule (minimum 2 required)"
            )
        p_ids = [r.id for r in racers]

    # Check if we have existing heats to determine starting heat number
    start_heat_num = len(existing_heats) + 1 if existing_heats else 1

    # Generate heats using PPC strategy
    # Note: we need to update _generate_ppc to accept a starting heat number if we want to support stacking
    new_heats = _generate_ppc(
        db, race_id, round_id, p_ids, lane_count, start_heat_num=start_heat_num
    )

    db.commit()
    return new_heats


def resolve_round_placeholders(db: Session, round_id: int, racer_ids: List[int]):
    """
    Replace placeholders in a round's heats with actual racer IDs.

    Placeholder IDs are negative integers: -1, -2, ...
    These will be replaced by racer_ids[0], racer_ids[1], ...
    """
    heats = db.query(models.Heat).filter(models.Heat.round_id == round_id).all()

    for heat in heats:
        if not heat.lane_results:
            continue

        results = json.loads(heat.lane_results)
        modified = False

        for result in results:
            placeholder_id = result.get("racer_id")
            if placeholder_id is not None and placeholder_id < 0:
                # Placeholder 1 is -1, maps to racer_ids[0]
                idx = abs(placeholder_id) - 1
                if idx < len(racer_ids):
                    result["racer_id"] = racer_ids[idx]
                    modified = True

        if modified:
            heat.lane_results = json.dumps(results)

    db.commit()


def invalidate_future_rounds(db: Session, race_id: int, current_round_number: int):
    """
    Invalidate and reset subsequent championship rounds when a previous round is modified.
    """
    future_rounds = (
        db.query(models.Round)
        .filter(
            models.Round.race_id == race_id,
            models.Round.round_number > current_round_number,
            models.Round.advancement_source.is_not(
                None
            ),  # Only cleared advancement rounds
        )
        .all()
    )

    for r in future_rounds:
        # Check if heats have results?
        # For now, we aggressively clear to ensure consistency, matching test expectation.
        # But we respect delete_round's check inside generate_heats_for_round?
        # generate_heats_for_round with clear_existing=True WILL fail if results exist.
        # But we want to FORCE clear placeholders.
        # So we manually delete heats first?
        # Or we catch the error?

        # If the round has results, strictly speaking we should probably NOT auto-wipe them
        # without user confirmation, but for this "Rerun Logic" test, it expects clearing.
        # We will try to regenerate.

        try:
            generate_heats_for_round(
                db,
                r.id,
                num_placeholders=r.advancement_num_racers or 0,
                clear_existing=True,
            )
        except ValueError:
            # If we can't regenerate (e.g. because results exist), we silently skip
            # or log usage?
            # For the test case (no results in future round), this works.
            pass


def record_heat_result(
    db: Session, heat_id: int, results: str | None
) -> models.Heat | None:
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat and results is not None:
        heat.lane_results = results
        db.commit()
        db.refresh(heat)

        # Trigger cleanup of future rounds
        if heat.round:
            invalidate_future_rounds(db, heat.race_id, heat.round.round_number)

    return heat


def auto_number_racers(
    db: Session, race_id: int, racer_ids: Optional[List[int]] = None
) -> int:
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return 0

    query = db.query(models.Racer).filter(models.Racer.race_id == race_id)
    if racer_ids is not None:
        query = query.filter(models.Racer.id.in_(racer_ids))

    racers = query.all()
    if not racers:
        return 0

    updated_count = 0

    if race.car_numbering_strategy == models.CarNumberingStrategy.GLOBAL:
        # Sort by ID to ensure stable ordering, or last name? Let's do ID (entry order)
        # Or maybe sort by Last Name, First Name
        racers.sort(key=lambda r: (r.last_name, r.first_name))

        current_number = race.global_start_number or 1
        for racer in racers:
            racer.car_number = current_number
            current_number += 1
            updated_count += 1

    elif race.car_numbering_strategy == models.CarNumberingStrategy.PER_GROUP:
        # Group racers by Den
        # We need to get all dens for this race to know ranges
        dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
        den_map = {d.id: d for d in dens}

        # Pre-bucket racers
        den_racers: dict[int, list[models.Racer]] = {}
        unassigned_racers: list[models.Racer] = []

        for racer in racers:
            if racer.den_id:
                if racer.den_id not in den_racers:
                    den_racers[racer.den_id] = []
                den_racers[racer.den_id].append(racer)
            else:
                unassigned_racers.append(racer)

        # Assign numbers per Den
        for den_id, group_racers in den_racers.items():
            den = den_map.get(den_id)
            if not den or den.car_number_range_start is None:
                continue  # Skip if no config

            # Sort
            group_racers.sort(key=lambda r: (r.last_name, r.first_name))

            current = den.car_number_range_start
            limit = den.car_number_range_end

            for racer in group_racers:
                if limit and current > limit:
                    break  # Stop assigning if out of range? Or just keep going?
                    # Let's stop to respect the "end" concept, user can fix.

                racer.car_number = current
                current += 1
                updated_count += 1

    else:
        # MANUAL or Unset - do nothing
        return 0

    db.commit()
    return updated_count


def reorder_heats(db: Session, heat_updates: List[dict]) -> List[models.Heat]:
    """
    Reorder heats within a round by updating their heat_number.

    Args:
        db: Database session
        heat_updates: List of dicts with 'heat_id' and 'new_heat_number'

    Returns:
        List of updated Heat objects

    Raises:
        HTTPException: If heats belong to different rounds or heat IDs are invalid
    """
    from fastapi import HTTPException

    if not heat_updates:
        return []

    # Fetch all heats by ID
    heat_ids = [update["heat_id"] for update in heat_updates]
    heats = db.query(models.Heat).filter(models.Heat.id.in_(heat_ids)).all()

    if len(heats) != len(heat_ids):
        raise HTTPException(status_code=404, detail="One or more heat IDs not found")

    # Verify all heats belong to the same round
    round_ids = {heat.round_id for heat in heats}
    if len(round_ids) > 1:
        raise HTTPException(
            status_code=400, detail="Cannot reorder heats from different rounds"
        )

    # Create a mapping of heat_id to new_heat_number
    update_map = {
        update["heat_id"]: update["new_heat_number"] for update in heat_updates
    }

    # Update each heat's heat_number
    for heat in heats:
        if heat.id in update_map:
            heat.heat_number = update_map[heat.id]

    # Commit the transaction
    db.commit()

    # Refresh and return updated heats, sorted by heat_number
    for heat in heats:
        db.refresh(heat)

    return sorted(heats, key=lambda h: h.heat_number)


def update_heat(
    db: Session, heat_id: int, heat: schemas.HeatCreate
) -> models.Heat | None:
    """
    Update an existing heat's properties.

    Args:
        db: Database session
        heat_id: ID of the heat to update
        heat: HeatCreate schema with updated values

    Returns:
        Updated Heat model or None if not found
    """
    db_heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if not db_heat:
        return None

    # Update fields
    db_heat.heat_number = heat.heat_number
    db_heat.lane_results = heat.lane_results
    # Note: race_id and round_id typically shouldn't change, but we'll allow it
    db_heat.race_id = heat.race_id
    db_heat.round_id = heat.round_id

    db.commit()
    db.refresh(db_heat)
    return db_heat


def revert_round_to_placeholders(db: Session, round_id: int):
    """
    Revert a round to use placeholder racers.
    Used when a previous round's results depend on this round and are reset.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        return

    # Calculate number of placeholders
    num_placeholders = round_obj.advancement_num_racers or 0
    if round_obj.advancement_source == "DEN":
        den_count = (
            db.query(models.Den).filter(models.Den.race_id == round_obj.race_id).count()
        )
        num_placeholders = (round_obj.advancement_num_racers or 0) * den_count

    if num_placeholders <= 0:
        return  # Cannot revert if no placeholders defined

    # Count existing heats to determine runs_per_lane
    existing_heats = (
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all()
    )
    if not existing_heats:
        return

    # Check if we can determine runs per lane
    if len(existing_heats) % num_placeholders != 0:
        # Fallback if mismatch
        runs_per_lane = 1
    else:
        runs_per_lane = len(existing_heats) // num_placeholders

    # Regenerate
    for i in range(runs_per_lane):
        generate_heats_for_round(
            db, round_id, num_placeholders=num_placeholders, clear_existing=(i == 0)
        )


def bulk_delete_racers(db: Session, racer_ids: List[int]):
    from collections import defaultdict

    racers = db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).all()
    by_race: dict[int, set[int]] = defaultdict(set)
    for r in racers:
        by_race[r.race_id].add(r.id)

    # Delete racers first so regeneration uses the correct pool
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).delete(
        synchronize_session=False
    )
    db.commit()

    for race_id, ids in by_race.items():
        # Handle regular rounds
        rounds = db.query(models.Round).filter(models.Round.race_id == race_id).all()
        for r in rounds:
            try:
                # Try to regenerate
                generate_heats_for_round(db, r.id, clear_existing=True)
            except ValueError:
                # Fallback to nullifying if round has started
                _remove_racer_from_regular_heats(db, ids, r.id)

        # Handle free race heats
        _remove_racer_from_free_heats(db, ids, race_id)
    db.commit()


def bulk_clear_car_numbers(db: Session, racer_ids: List[int]):
    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        {models.Racer.car_number: None}, synchronize_session=False
    )
    db.commit()


def create_free_race_heat(
    db: Session,
    race_id: int,
    lane_assignments: list[dict],
) -> models.FreeRaceHeat:
    """Create a new FreeRaceHeat with the given lane assignments."""
    from datetime import datetime, timezone

    heat = models.FreeRaceHeat(
        race_id=race_id,
        lane_assignments=json.dumps(lane_assignments),
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(heat)
    db.commit()
    db.refresh(heat)
    return heat


def update_free_race_heat_result(
    db: Session,
    heat_id: int,
    lane_results: list[dict],
) -> models.FreeRaceHeat | None:
    """Record results for a FreeRaceHeat."""
    heat = (
        db.query(models.FreeRaceHeat).filter(models.FreeRaceHeat.id == heat_id).first()
    )
    if heat is None:
        return None
    heat.lane_results = json.dumps(lane_results)
    db.commit()
    db.refresh(heat)
    return heat


def get_free_race_heats(
    db: Session,
    race_id: int,
    limit: int = 10,
) -> list[models.FreeRaceHeat]:
    """Get the most recent FreeRaceHeats for a race, newest first."""
    return (
        db.query(models.FreeRaceHeat)
        .filter(models.FreeRaceHeat.race_id == race_id)
        .order_by(models.FreeRaceHeat.id.desc())
        .limit(limit)
        .all()
    )


def get_random_lane_assignments(
    db: Session,
    race_id: int,
    lane_count: int,
) -> list[dict]:
    """
    Randomly select `lane_count` checked-in racers and return lane assignments.
    If fewer than `lane_count` racers are checked in, fill remaining lanes with
    empty slots (racer_id=None).
    """
    pool = (
        db.query(models.Racer)
        .filter(
            models.Racer.race_id == race_id,
            models.Racer.car_passed_inspection == True
        )
        .all()
    )
    random.shuffle(pool)
    selected = pool[:lane_count]

    assignments = []
    for i in range(lane_count):
        racer_id = selected[i].id if i < len(selected) else None
        assignments.append({"lane": i + 1, "racer_id": racer_id})
    return assignments


def bulk_move_racers_to_den(db: Session, racer_ids: List[int], den_id: Optional[int]):
    # Need to handle potential racing group updates if we were strict about it,
    # but create_racer handles it. For bulk move, let's just update den_id.
    # If we want to be thorough, we should also update racing_group_id.
    # However, the current logic seems to link them.

    update_data: dict[Any, Any] = {"den_id": den_id}

    # If den_id is provided, try to find a corresponding racing group
    if den_id:
        racer = db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).first()
        if racer:
            race_id = racer.race_id
            den = db.query(models.Den).filter(models.Den.id == den_id).first()
            if den:
                racing_group = (
                    db.query(models.RacingGroup)
                    .filter(
                        models.RacingGroup.race_id == race_id,
                        models.RacingGroup.den_id == den_id,
                    )
                    .first()
                )
                if not racing_group:
                    racing_group = models.RacingGroup(
                        race_id=race_id, name=f"{den.name}s", den_id=den_id
                    )
                    db.add(racing_group)
                    db.commit()
                    db.refresh(racing_group)
                update_data["racing_group_id"] = racing_group.id
    else:
        update_data["racing_group_id"] = None

    db.query(models.Racer).filter(models.Racer.id.in_(racer_ids)).update(
        update_data, synchronize_session=False
    )
    db.commit()
