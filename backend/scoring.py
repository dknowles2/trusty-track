"""
Scoring calculation functions for race results.

This module provides functions to calculate scores and generate leaderboards
based on different scoring strategies (TIMED or POINTS).
"""

from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from . import models, crud
import json


def calculate_racer_scores(db: Session, race_id: int) -> Dict[int, Dict[str, float]]:
    """
    Calculate scores for all racers in a race.
    
    Args:
        db: Database session
        race_id: ID of the race
        
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
    
    heats = crud.get_heats(db, race_id)
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
                    "total_points": 0
                }
            
            # Only count heats where the racer has a result
            time = result.get("time")
            place = result.get("place")
            
            if scoring_strategy == models.ScoringStrategy.TIMED:
                if time is not None:
                    racer_scores[racer_id]["total_time"] += time
                    racer_scores[racer_id]["heats_completed"] += 1
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


def get_leaderboard(db: Session, race_id: int) -> List[Dict]:
    """
    Get the current leaderboard for a race.
    
    Args:
        db: Database session
        race_id: ID of the race
        
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
    
    racer_scores = calculate_racer_scores(db, race_id)
    
    # Get racer details
    racers = crud.get_racers(db, race_id)
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
        
        leaderboard.append({
            "racer_id": racer_id,
            "first_name": racer.first_name,
            "last_name": racer.last_name,
            "car_number": racer.car_number,
            "den_name": den.name if den else "Unknown",
            "score": score_data["score"],
            "heats_completed": score_data["heats_completed"]
        })
    
    # Sort by score (ascending - lower is better for both strategies)
    leaderboard.sort(key=lambda x: (x["score"] if x["heats_completed"] > 0 else float('inf'), x["racer_id"]))
    
    # Add rank
    for idx, entry in enumerate(leaderboard):
        entry["rank"] = idx + 1
    
    return leaderboard
