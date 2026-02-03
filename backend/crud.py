from typing import List, Any, Optional
import json
import random
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

def get_dens(db: Session, race_id: int, skip: int = 0, limit: int = 100) -> List[models.Den]:
    return db.query(models.Den).filter(models.Den.race_id == race_id).offset(skip).limit(limit).all()

def get_den(db: Session, den_id: int) -> models.Den | None:
    return db.query(models.Den).filter(models.Den.id == den_id).first()

def get_den_by_name(db: Session, name: str, race_id: int) -> models.Den | None:
    # Example: Case insensitive search could be done here if DB supports it easily,
    # or just do exact match for simplicity first
    return db.query(models.Den).filter(models.Den.name == name, models.Den.race_id == race_id).first()

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

def update_den(db: Session, den_id: int, den_update: schemas.DenUpdate) -> models.Den | None:
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
    return db.query(models.Race).offset(skip).limit(limit).all()

def create_race(db: Session, race: schemas.RaceCreate) -> models.Race:
    race_data = race.model_dump()
    db_race = models.Race(**race_data)
    db.add(db_race)
    db.commit()
    db.refresh(db_race)
    return db_race

def update_race(db: Session, race_id: int, race_update: schemas.RaceUpdate) -> models.Race | None:
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
    return db.query(models.Race).filter(models.Race.id == race_id).first()

def get_track(db: Session) -> models.Track | None:
    return db.query(models.Track).first()

def create_track(db: Session, track: schemas.TrackCreate) -> models.Track:
    db_track = models.Track(**track.model_dump())
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track

def create_initial_config(db: Session, config: schemas.InitialConfigCreate) -> tuple[models.Group, models.Track]:
    # Create Group
    group = models.Group(name=config.group_name)
    db.add(group)
    
    # Create Track
    track = models.Track(
        lane_count=config.lane_count,
        length_feet=config.length_feet,
        timer_type=config.timer_type
    )
    db.add(track)
    
    db.commit()
    db.refresh(group)
    db.refresh(track)
    return group, track

def update_group(db: Session, group: models.Group, name: str) -> models.Group:
    group.name = name
    db.commit()
    db.refresh(group)
    return group

def update_track(db: Session, track: models.Track, config: schemas.InitialConfigCreate) -> models.Track:
    track.lane_count = config.lane_count
    track.length_feet = config.length_feet
    track.timer_type = config.timer_type
    db.commit()
    db.refresh(track)
    return track

def get_racers(db: Session, skip: int = 0, limit: int = 100, race_id: int | None = None) -> List[models.Racer]:
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
    if 'race_id' in racer_data:
        del racer_data['race_id']
        
    den_id = racer_data.get("den_id")

    # Handle Racing Group based on Den
    if den_id:
        den = get_den(db, den_id)
        if den:
            # Find or create racing group for this Den
            racing_group = db.query(models.RacingGroup).filter(
                models.RacingGroup.race_id == race.id,
                models.RacingGroup.den_id == den_id
            ).first()

            if not racing_group:
                racing_group = models.RacingGroup(
                    race_id=race.id,
                    name=f"{den.name}s",
                    den_id=den_id
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

def update_racer(db: Session, racer_id: int, racer_update: schemas.RacerUpdate) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if not db_racer:
        return None
    
    update_data = racer_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_racer, key, value)
        
    db.commit()
    db.refresh(db_racer)
    return db_racer

def delete_racer(db: Session, racer_id: int) -> models.Racer | None:
    db_racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if db_racer:
        db.delete(db_racer)
        db.commit()
    return db_racer

def get_heats(db: Session, race_id: int) -> List[models.Heat]:
    """Get all heats for a specific race, ordered by round and heat number."""
    return db.query(models.Heat).filter(models.Heat.race_id == race_id).join(models.Round).order_by(models.Round.round_number, models.Heat.heat_number).all()

def get_rounds(db: Session, race_id: int) -> List[models.Round]:
    """Get all rounds for a specific race, ordered by round number."""
    return db.query(models.Round).filter(models.Round.race_id == race_id).order_by(models.Round.round_number).all()

def create_round(db: Session, race_id: int, round_number: int, scheduling_strategy: models.SchedulingStrategy) -> models.Round:
    """Create a new round for a race."""
    round_obj = models.Round(
        race_id=race_id,
        round_number=round_number,
        scheduling_strategy=scheduling_strategy
    )
    db.add(round_obj)
    db.commit()
    db.refresh(round_obj)
    return round_obj

def delete_round(db: Session, round_id: int) -> bool:
    """Delete a round and all its heats."""
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if round_obj:
        db.delete(round_obj)
        db.commit()
        return True
    return False

def _generate_lane_rotation(db: Session, race_id: int, round_id: int, racers: List[models.Racer], lane_count: int) -> List[models.Heat]:
    """
    Generate Lane Rotation (Perfect N-Stage) heats.
    Each racer runs exactly once in every lane.
    Formula: Participant at index (i + j) % P is assigned to Lane j in Heat i.
    """
    racer_ids = [r.id for r in racers]
    random.shuffle(racer_ids)
    P = len(racer_ids)
    L = lane_count
    
    generated_heats: List[models.Heat] = []
    for i in range(P):
        lane_assignment: List[dict[str, Any]] = []
        for j in range(L):
            # Formula: (i + j) % P
            r_id = racer_ids[(i + j) % P]
            lane_assignment.append({
                "lane": j + 1,
                "racer_id": r_id,
                "time": None,
                "place": None
            })
        
        heat = models.Heat(
            race_id=race_id,
            round_id=round_id,
            heat_number=i + 1,
            lane_results=json.dumps(lane_assignment)
        )
        db.add(heat)
        generated_heats.append(heat)
    return generated_heats

def _generate_ppc(db: Session, race_id: int, round_id: int, racers: List[models.Racer], lane_count: int) -> List[models.Heat]:
    """
    Generate Partial Perfect Chart (PPC) heats.
    Uses greedy optimization to balance lane usage and maximize opponent variety.
    """
    p_ids = [r.id for r in racers]
    random.shuffle(p_ids)
    P = len(p_ids)
    L = lane_count
    
    # Matchup matrix
    matchups: dict[int, dict[int, int]] = {p1: {p2: 0 for p2 in p_ids} for p1 in p_ids}
    
    # heat_matrix[heat_idx][lane_idx] = racer_id
    heat_matrix: List[List[Optional[int]]] = [[None for _ in range(L)] for _ in range(P)]
    
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
            current_heat_racers = [heat_matrix[i][k] for k in range(j) if heat_matrix[i][k] is not None]
            
            # Candidates: hasn't been in this lane AND not in current heat
            # (Note: r is never None in current_heat_racers)
            candidates = [r for r in available_racers if j not in occupied_lanes[r] and r not in current_heat_racers]
            
            if not candidates:
                # Fallback: just not in current heat
                candidates = [r for r in available_racers if r not in current_heat_racers]

            best_racer = None
            min_score = float('inf')
            for r in candidates:
                score = sum(matchups[r][other] for other in current_heat_racers if other is not None)
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
            lane_assignment.append({
                "lane": j + 1,
                "racer_id": heat_matrix[i][j],
                "time": None,
                "place": None
            })
        heat = models.Heat(
            race_id=race_id,
            round_id=round_id,
            heat_number=i + 1,
            lane_results=json.dumps(lane_assignment)
        )
        db.add(heat)
        generated_heats.append(heat)
    return generated_heats


def _generate_stearns(db: Session, race_id: int, round_id: int, racers: List[models.Racer], lane_count: int) -> List[models.Heat]:
    """
    Generate Stearns method heats (speed-based grouping).
    Uses timing data from previous rounds to create balanced heats.
    Requires at least one previous round with timing data.
    """
    # Get the current round to find previous rounds
    current_round = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not current_round:
        raise ValueError("Round not found")
    
    current_round_number = current_round.round_number
    
    # Get all heats from previous rounds
    previous_heats = db.query(models.Heat).join(models.Round).filter(
        models.Round.race_id == race_id,
        models.Round.round_number < current_round_number
    ).all()
    
    if not previous_heats:
        raise ValueError("Stearns scheduling requires timing data from previous rounds")
    
    # Calculate average time for each racer
    racer_times: dict[int, List[float]] = {}
    for heat in previous_heats:
        if not heat.lane_results:
            continue
        results = json.loads(heat.lane_results)
        for result in results:
            racer_id = result.get("racer_id")
            time = result.get("time")
            if racer_id and time is not None:
                if racer_id not in racer_times:
                    racer_times[racer_id] = []
                racer_times[racer_id].append(time)
    
    # Calculate averages
    racer_averages = {
        racer_id: sum(times) / len(times)
        for racer_id, times in racer_times.items()
        if times
    }
    
    # Check if we have enough timing data (at least 50% of racers)
    if len(racer_averages) < len(racers) * 0.5:
        raise ValueError(f"Insufficient timing data for Stearns scheduling. Only {len(racer_averages)}/{len(racers)} racers have times.")
    
    # Sort racers by average time (fastest first)
    # Racers without times go to the end
    sorted_racers = sorted(
        racers,
        key=lambda r: racer_averages.get(r.id, float('inf'))
    )
    
    P = len(sorted_racers)
    L = lane_count
    num_heats = (P + L - 1) // L  # Ceiling division
    
    # Create heats using snake distribution
    heat_assignments: List[List[int]] = [[] for _ in range(num_heats)]
    
    for i, racer in enumerate(sorted_racers):
        heat_idx = i // L
        # Snake pattern: alternate direction for each row
        if (i // L) % 2 == 0:
            # Forward: assign to heat in order
            target_heat = heat_idx
        else:
            # Backward: reverse assignment for snake pattern
            target_heat = num_heats - 1 - (heat_idx - (i // L))
        
        if target_heat < num_heats:
            heat_assignments[target_heat].append(racer.id)
    
    # Generate heats with lane rotation for fairness
    generated_heats: List[models.Heat] = []
    for heat_num, racer_ids_in_heat in enumerate(heat_assignments):
        if not racer_ids_in_heat:
            continue
        
        # Rotate lane assignments based on heat number to ensure fairness
        lane_assignment = []
        for lane_idx in range(len(racer_ids_in_heat)):
            # Rotate: racer at position i goes to lane (i + heat_num) % num_racers_in_heat
            rotated_idx = (lane_idx + heat_num) % len(racer_ids_in_heat)
            racer_id = racer_ids_in_heat[rotated_idx]
            lane_assignment.append({
                "lane": lane_idx + 1,
                "racer_id": racer_id,
                "time": None,
                "place": None
            })
        
        heat = models.Heat(
            race_id=race_id,
            round_id=round_id,
            heat_number=heat_num + 1,
            lane_results=json.dumps(lane_assignment)
        )
        db.add(heat)
        generated_heats.append(heat)
    
    return generated_heats



def generate_heats_for_round(db: Session, round_id: int) -> List[models.Heat]:
    """
    Generate heats for a specific round based on its scheduling strategy.
    """
    round_obj = db.query(models.Round).filter(models.Round.id == round_id).first()
    if not round_obj:
        raise ValueError(f"Round {round_id} not found")
    
    race_id = round_obj.race_id
    track = db.query(models.Track).first()
    lane_count = track.lane_count if track else 4

    racers = db.query(models.Racer).filter(models.Racer.race_id == race_id).all()
    if not racers or len(racers) < 2:
        raise ValueError("Not enough racers to generate a schedule (minimum 2 required)")
    
    # Generate heats based on the round's scheduling strategy
    if round_obj.scheduling_strategy == models.SchedulingStrategy.LANE_ROTATION:
        new_heats = _generate_lane_rotation(db, race_id, round_id, racers, lane_count)
    elif round_obj.scheduling_strategy == models.SchedulingStrategy.PPC:
        new_heats = _generate_ppc(db, race_id, round_id, racers, lane_count)
    elif round_obj.scheduling_strategy == models.SchedulingStrategy.STEARNS:
        new_heats = _generate_stearns(db, race_id, round_id, racers, lane_count)
    else:
        new_heats = _generate_lane_rotation(db, race_id, round_id, racers, lane_count)
    
    db.commit()
    return new_heats

def record_heat_result(db: Session, heat_id: int, results: str | None) -> models.Heat | None:
    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat and results is not None:
        heat.lane_results = results
        db.commit()
        db.refresh(heat)
    return heat

def auto_number_racers(db: Session, race_id: int) -> int:
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if not race:
        return 0
        
    racers = db.query(models.Racer).filter(models.Racer.race_id == race_id).all()
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
                continue # Skip if no config
            
            # Sort
            group_racers.sort(key=lambda r: (r.last_name, r.first_name))
            
            current = den.car_number_range_start
            limit = den.car_number_range_end
            
            for racer in group_racers:
                if limit and current > limit:
                     break # Stop assigning if out of range? Or just keep going?
                     # Let's stop to respect the "end" concept, user can fix.
                
                racer.car_number = current
                current += 1
                updated_count += 1
                
    else:
        # MANUAL or Unset - do nothing
        return 0
        
    db.commit()
    return updated_count
