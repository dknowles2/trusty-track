"""
Scoring calculation functions for race results.

This module provides functions to calculate scores and generate leaderboards
based on different scoring strategies (TIMED or POINTS).
"""

import json
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.db import crud, models


def calculate_racer_scores(
    db: Session, race_id: int, round_id: Optional[int] = None
) -> Dict[int, Dict[str, float]]:
    """
    Calculate scores for all racers in a race (optionally filtered by round).

    Args:
        db: Database session
        race_id: ID of the race
        round_id: Optional ID of the round to limit calculation to

    Returns:
        Dictionary mapping racer_id to score info:
        {
            racer_id: {
                "score": float,  # Average time or total points
                "heats_completed": int,  # Number of heats with results
                "total_time": float,  # Only for TIMED
                "total_points": int  # Only for POINTS
            }
        }
    """
    race = crud.get_race(db, race_id)
    if not race:
        return {}

    heats = crud.get_heats(db, race_id, round_id=round_id)
    scoring_strategy = race.scoring_strategy

    # Initialize racer scores
    racer_scores: Dict[int, Dict[str, float]] = {}

    for heat in heats:
        if not heat.lane_results:
            continue

        results = json.loads(heat.lane_results)

        for result in results:
            racer_id = result.get("racer_id")
            if not racer_id:
                continue

            if racer_id not in racer_scores:
                racer_scores[racer_id] = {
                    "score": 0.0,
                    "heats_completed": 0,
                    "total_time": 0.0,
                    "total_points": 0,
                }

            # Only count heats where the racer has a result
            time = result.get("time")
            place = result.get("place")

            if scoring_strategy == models.ScoringStrategy.TIMED:
                if time is not None:
                    try:
                        t_val = float(time)
                        # Handle DNF: 0.0s is often sent by timers when a racer
                        # fails to finish. We treat this as a 9.999s penalty.
                        if t_val <= 0.0:
                            t_val = 9.999
                        r_data = racer_scores[racer_id]
                        r_data["total_time"] += t_val
                        r_data["heats_completed"] += 1
                    except (ValueError, TypeError):
                        pass  # Ignore invalid times
            elif scoring_strategy == models.ScoringStrategy.POINTS:
                if place is not None:
                    racer_scores[racer_id]["total_points"] += place
                    racer_scores[racer_id]["heats_completed"] += 1

    # Calculate final scores
    for racer_id, data in racer_scores.items():
        if data["heats_completed"] > 0:
            if scoring_strategy == models.ScoringStrategy.TIMED:
                # Average time
                data["score"] = data["total_time"] / data["heats_completed"]
            elif scoring_strategy == models.ScoringStrategy.POINTS:
                # Total points (lower is better)
                data["score"] = data["total_points"]

    return racer_scores


def get_leaderboard(
    db: Session, race_id: int, round_id: Optional[int] = None
) -> List[Dict]:
    """
    Get the current leaderboard for a race (optionally filtered by round).

    Args:
        db: Database session
        race_id: ID of the race
        round_id: Optional ID of the round to limit calculation to

    Returns:
        List of racer standings, sorted by score (ascending - lower is better):
        [
            {
                "racer_id": int,
                "first_name": str,
                "last_name": str,
                "car_number": int,
                "den_name": str,
                "score": float,
                "heats_completed": int,
                "rank": int  # 1-indexed position
            },
            ...
        ]
    """
    race = crud.get_race(db, race_id)
    if not race:
        return []

    racer_scores = calculate_racer_scores(db, race_id, round_id=round_id)

    # Get racer details
    racers = crud.get_racers(db, race_id=race_id)
    racer_map = {r.id: r for r in racers}

    # Get den details
    dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
    den_map = {d.id: d for d in dens}

    # Build leaderboard entries
    leaderboard = []
    for racer_id, score_data in racer_scores.items():
        racer = racer_map.get(racer_id)
        if not racer:
            continue

        den = den_map.get(racer.den_id) if racer.den_id else None

        leaderboard.append(
            {
                "racer_id": racer_id,
                "first_name": racer.first_name,
                "last_name": racer.last_name,
                "car_number": racer.car_number,
                "den_id": racer.den_id,
                "den_name": den.name if den else "Unknown",
                "score": score_data["score"],
                "heats_completed": score_data["heats_completed"],
                "racer_image_url": racer.racer_image_url,
            }
        )

    # Sort by score (ascending - lower is better for both strategies)
    leaderboard.sort(
        key=lambda x: (
            float(x["score"]) if x["heats_completed"] > 0 else float("inf"),
            x["racer_id"],
        )
    )

    # Add rank
    for idx, entry in enumerate(leaderboard):
        entry["rank"] = idx + 1

    return leaderboard


def get_advancing_racers(
    db: Session, race_id: int, source: str, num_top: int
) -> List[int]:
    """
    Get IDs of racers who should advance to a championship round.

    Args:
        db: Database session
        race_id: ID of the race
        source: "PACK" (overall winners), "DEN" (top per den), or "ROUND:<id>" (round specific)
        num_top: Number of top racers to pick (if "DEN", it's per den)

    Returns:
        List of racer IDs, sorted by rank.
    """
    if source.startswith("ROUND:"):
        try:
            round_id = int(source.split(":")[1])
            standings = get_leaderboard(db, race_id, round_id=round_id)
            return [s["racer_id"] for s in standings[:num_top]]
        except (ValueError, IndexError):
            return []

    standings = get_leaderboard(db, race_id)

    if source == "PACK":
        # Simply pick the top N from the entire leaderboard
        return [s["racer_id"] for s in standings[:num_top]]

    elif source == "DEN":
        # Group by den and pick top N from each
        advancing_ids = []
        dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()

        for den in dens:
            den_standings = [s for s in standings if s["den_id"] == den.id]
            # Since standings is already sorted overall, den_standings order is preserved
            advancing_ids.extend([s["racer_id"] for s in den_standings[:num_top]])

        return advancing_ids

    return []
