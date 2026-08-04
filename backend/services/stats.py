"""
Statistics computation functions for race results.

This module provides functions to calculate per-racer stats, lane fairness,
den comparisons, highlights, and exportable heat results for a race.
"""

import math

from sqlalchemy.orm import Session

from backend.db import crud, models
from backend.domain import lanes

DNF_PENALTY = 9.999


def compute_race_stats(db: Session, race_id: int) -> dict | None:
    """
    Top-level entry point for race statistics.

    Returns a dict matching the RaceStats Strawberry type, or None if race not found.
    """
    race = crud.get_race(db, race_id)
    if not race:
        return None

    # Official heats only: free race results are exhibition runs and would
    # distort every statistic here (#6).
    heats = models.official_heats(
        db.query(models.Heat).filter(models.Heat.race_id == race_id)
    ).all()
    rounds = db.query(models.Round).filter(models.Round.race_id == race_id).all()
    round_map = {r.id: r for r in rounds}

    dens = db.query(models.Den).filter(models.Den.race_id == race_id).all()
    racers = db.query(models.Racer).filter(models.Racer.race_id == race_id).all()
    racer_map = {r.id: r for r in racers}
    den_map = {d.id: d for d in dens}

    track = (
        db.query(models.Track).filter(models.Track.id == race.track_id).first()
        if race.track_id
        else None
    )
    lane_count = track.lane_count if track else 4

    # Pre-calculate global heat numbers
    sorted_heats = sorted(
        heats,
        key=lambda h: (
            round_map.get(h.round_id).round_number if round_map.get(h.round_id) else 0,
            h.heat_number,
        ),
    )
    global_heat_map = {h.id: idx + 1 for idx, h in enumerate(sorted_heats)}

    total_heats_scheduled = len(heats)
    total_heats_completed = 0

    # racer_id -> count of heats they appear in (scheduled, with or without results)
    racer_heat_counts: dict[int, int] = {}
    # Enriched results from completed heats only (has at least one time)
    all_results: list[dict] = []
    # Completed heats with round context, for highlights and heat_results
    heats_with_rounds: list[dict] = []

    for heat in heats:
        if not heat.lane_results:
            continue
        # Through `lanes.parse`, not `json.loads`: it is the only sanctioned
        # reader of the blob (#5). Mostly that is consolidation — this module
        # already coerced times with `float()` and skipped falsy racer ids — but
        # the codec also refuses anything that is not a lane, where parsing here
        # iterated it and took the whole stats page down with an AttributeError.
        # `real_racer_id` is `None` for an unadvanced championship slot, which
        # the blob encodes as a negative id, and `seconds` is a number where the
        # stored time may be the string the frontend sometimes wrote.
        results = [
            {
                "lane": parsed.lane,
                "racer_id": parsed.real_racer_id,
                "time": parsed.seconds,
                "place": parsed.place,
            }
            for parsed in lanes.parse(heat.lane_results)
        ]

        round_obj = round_map.get(heat.round_id)
        round_name = (
            round_obj.name
            if (round_obj and round_obj.name)
            else f"Round {heat.heat_number}"
        )

        # Count scheduled heats for each racer (regardless of completion)
        for r in results:
            racer_id = r.get("racer_id")
            if racer_id:
                racer_heat_counts[racer_id] = racer_heat_counts.get(racer_id, 0) + 1

        # A heat is "completed" if at least one racer has a recorded time
        has_result = any(
            r.get("time") is not None for r in results if r.get("racer_id")
        )
        if not has_result:
            continue

        total_heats_completed += 1

        for r in results:
            racer_id = r.get("racer_id")
            if not racer_id:
                continue
            enriched = dict(r)
            enriched["round_name"] = round_name
            all_results.append(enriched)

        heats_with_rounds.append(
            {
                "heat": heat,
                "round_name": round_name,
                "global_heat_number": global_heat_map.get(heat.id, 0),
                "results": results,
            }
        )

    scoring_strategy = (
        race.scoring_strategy.value
        if hasattr(race.scoring_strategy, "value")
        else str(race.scoring_strategy)
    )

    return {
        "race_id": race.id,
        "race_name": race.name,
        "scoring_strategy": scoring_strategy,
        "total_heats_scheduled": total_heats_scheduled,
        "total_heats_completed": total_heats_completed,
        "total_racers": len(racers),
        "lane_stats": _compute_lane_stats(all_results, lane_count),
        "racer_stats": _compute_racer_stats(
            all_results, racer_heat_counts, racer_map, den_map
        ),
        "highlights": _compute_highlights(heats_with_rounds, racer_map),
        "den_stats": _compute_den_stats(
            _compute_racer_stats(all_results, racer_heat_counts, racer_map, den_map),
            dens,
        ),
        "heat_results": _compute_heat_results(heats_with_rounds, racer_map),
    }


def _compute_lane_stats(all_results: list, lane_count: int) -> list:
    """
    Compute per-lane fairness statistics.

    Only counts non-DNF times. Positive relative_advantage_pct means faster
    than overall average (lane favors racers).
    """
    lane_times: dict[int, list[float]] = {}

    for r in all_results:
        lane = r.get("lane")
        time = r.get("time")
        if lane is None or time is None:
            continue
        t = float(time)
        if t <= 0.0:
            t = DNF_PENALTY
        if t < DNF_PENALTY:
            if lane not in lane_times:
                lane_times[lane] = []
            lane_times[lane].append(t)

    all_valid = [t for times in lane_times.values() for t in times]
    overall_avg = sum(all_valid) / len(all_valid) if all_valid else None

    stats = []
    for lane in range(1, lane_count + 1):
        times = lane_times.get(lane, [])
        avg = sum(times) / len(times) if times else None
        rel_adv = (
            (overall_avg - avg) / overall_avg * 100
            if (avg is not None and overall_avg)
            else None
        )
        heat_count = sum(
            1 for r in all_results if r.get("lane") == lane and r.get("racer_id")
        )
        stats.append(
            {
                "lane": lane,
                "avg_time": avg,
                "heat_count": heat_count,
                "relative_advantage_pct": rel_adv,
            }
        )

    return stats


def _compute_racer_stats(
    all_results: list,
    racer_heat_counts: dict,
    racer_map: dict,
    den_map: dict,
) -> list:
    """
    Compute per-racer statistics.

    Includes min/mean/max/std_dev of non-DNF times, plus per-lane breakdowns.
    Internal dicts carry _den_id for use by _compute_den_stats.
    Sorted by mean_time ascending (None last).
    """
    racer_times: dict[int, list[float]] = {}
    racer_lane_times: dict[int, dict[int, list[float]]] = {}

    for r in all_results:
        racer_id = r.get("racer_id")
        time = r.get("time")
        lane = r.get("lane")
        if not racer_id or time is None:
            continue

        t = float(time)
        if t <= 0.0:
            t = DNF_PENALTY

        if racer_id not in racer_times:
            racer_times[racer_id] = []
            racer_lane_times[racer_id] = {}

        racer_times[racer_id].append(t)

        if lane is not None:
            if lane not in racer_lane_times[racer_id]:
                racer_lane_times[racer_id][lane] = []
            racer_lane_times[racer_id][lane].append(t)

    stats = []
    for racer_id, times in racer_times.items():
        racer = racer_map.get(racer_id)
        if not racer:
            continue

        den = den_map.get(racer.den_id) if racer.den_id else None
        den_name = den.name if den else "Unassigned"

        valid = [t for t in times if t < DNF_PENALTY]
        heats_completed = len(times)

        if times:
            min_time = min(valid) if valid else DNF_PENALTY
            max_time = max(times)
            mean_time = sum(times) / len(times)
            if len(times) >= 2:
                variance = sum((t - mean_time) ** 2 for t in times) / len(times)
                std_dev = math.sqrt(variance)
            else:
                std_dev = None
        else:
            min_time = max_time = mean_time = std_dev = None

        times_per_lane = []
        for lane, lane_t in racer_lane_times[racer_id].items():
            avg = sum(lane_t) / len(lane_t) if lane_t else None
            times_per_lane.append({"lane": lane, "avg_time": avg})
        times_per_lane.sort(key=lambda x: x["lane"])

        stats.append(
            {
                "racer_id": racer_id,
                "first_name": racer.first_name,
                "last_name": racer.last_name,
                "car_number": racer.car_number,
                "den_name": den_name,
                "_den_id": racer.den_id,
                "heats_completed": heats_completed,
                "heats_scheduled": racer_heat_counts.get(racer_id, 0),
                "min_time": min_time,
                "max_time": max_time,
                "mean_time": mean_time,
                "std_dev": std_dev,
                "times_per_lane": times_per_lane,
            }
        )

    stats.sort(key=lambda x: (x["mean_time"] is None, x["mean_time"] or 0.0))
    return stats


def _compute_highlights(heats_with_rounds: list, racer_map: dict) -> list:
    """
    Find fastest heat and closest race highlights.
    """
    fastest_time: float | None = None
    fastest_heat_data: dict | None = None
    fastest_racer_name: str | None = None

    closest_margin: float | None = None
    closest_heat_data: dict | None = None

    for item in heats_with_rounds:
        heat = item["heat"]
        round_name = item["round_name"]
        global_heat_number = item["global_heat_number"]
        results = item["results"]

        valid_pairs = []
        for r in results:
            t = r.get("time")
            racer_id = r.get("racer_id")
            if t is None or not racer_id:
                continue
            t = float(t)
            if t > 0.0:
                valid_pairs.append((t, r))

        if not valid_pairs:
            continue

        valid_pairs.sort(key=lambda x: x[0])
        best_time, best_result = valid_pairs[0]

        if fastest_time is None or best_time < fastest_time:
            fastest_time = best_time
            racer = racer_map.get(best_result.get("racer_id"))
            fastest_racer_name = (
                f"{racer.first_name} {racer.last_name}" if racer else None
            )
            fastest_heat_data = {
                "type": "FASTEST_HEAT",
                "round_name": round_name,
                "heat_number": heat.heat_number,
                "global_heat_number": global_heat_number,
                "time": best_time,
                "margin": None,
                "racer_name": fastest_racer_name,
            }

        if len(valid_pairs) >= 2:
            margin = valid_pairs[-1][0] - valid_pairs[0][0]
            if closest_margin is None or margin < closest_margin:
                closest_margin = margin
                closest_heat_data = {
                    "type": "CLOSEST_RACE",
                    "round_name": round_name,
                    "heat_number": heat.heat_number,
                    "global_heat_number": global_heat_number,
                    "time": valid_pairs[0][0],
                    "margin": margin,
                    "racer_name": None,
                }

    # Ensure fastest_heat_data has up-to-date racer_name
    if fastest_heat_data:
        fastest_heat_data["racer_name"] = fastest_racer_name

    highlights = []
    if fastest_heat_data:
        highlights.append(fastest_heat_data)
    if closest_heat_data:
        highlights.append(closest_heat_data)
    return highlights


def _compute_den_stats(racer_stats: list, dens: list) -> list:
    """
    Compute per-den aggregate statistics.
    Groups racer_stats by _den_id. Sorted by avg_score ascending.
    """
    den_racers: dict[int, list] = {}
    for rs in racer_stats:
        den_id = rs.get("_den_id")
        if den_id is None:
            continue
        if den_id not in den_racers:
            den_racers[den_id] = []
        den_racers[den_id].append(rs)

    den_map = {d.id: d for d in dens}

    stats = []
    for den_id, rs_list in den_racers.items():
        den = den_map.get(den_id)
        if not den:
            continue

        valid_means = [rs["mean_time"] for rs in rs_list if rs["mean_time"] is not None]
        avg_score = sum(valid_means) / len(valid_means) if valid_means else None

        best = None
        for rs in rs_list:
            if rs["mean_time"] is not None and (
                best is None or rs["mean_time"] < best["mean_time"]
            ):
                best = rs
        best_racer_name = f"{best['first_name']} {best['last_name']}" if best else None

        stats.append(
            {
                "den_id": den_id,
                "den_name": den.name,
                "den_color": den.color,
                "racer_count": len(rs_list),
                "avg_score": avg_score,
                "best_racer_name": best_racer_name,
            }
        )

    stats.sort(key=lambda x: (x["avg_score"] is None, x["avg_score"] or 0.0))
    return stats


def _compute_heat_results(heats_with_rounds: list, racer_map: dict) -> list:
    """
    Build a flat list of every lane result across all completed heats.
    Used for CSV export.
    """
    rows = []
    for item in heats_with_rounds:
        heat = item["heat"]
        round_name = item["round_name"]
        global_heat_number = item["global_heat_number"]
        results = item["results"]

        for r in results:
            racer_id = r.get("racer_id")
            if not racer_id:
                continue
            racer = racer_map.get(racer_id)
            if not racer:
                continue

            time_val = r.get("time")
            if time_val is not None:
                t = float(time_val)
                time_val = t if t > 0.0 else None

            rows.append(
                {
                    "round_name": round_name,
                    "heat_number": heat.heat_number,
                    "global_heat_number": global_heat_number,
                    "lane": r.get("lane"),
                    "car_number": racer.car_number,
                    "racer_first_name": racer.first_name,
                    "racer_last_name": racer.last_name,
                    "time": time_val,
                    "place": r.get("place"),
                }
            )

    return rows
