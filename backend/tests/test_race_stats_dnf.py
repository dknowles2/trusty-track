"""A genuine 9.999s-or-slower finish must not be mistaken for a DNF (#754).

`DNF_PENALTY_SECONDS`/`DNF_PENALTY` (9.999) is the value ``TIMED`` scoring
substitutes for an actual DNF — a recorded time of zero or less — never a
sentinel that real times cannot reach. `services/stats.py` used to test a
time's own magnitude (``t < DNF_PENALTY``) to decide whether it was "real",
which folds a slow-but-genuine result into "no time" the moment it reaches
9.999s: a long track, a slow rocket, or a Space Derby boat routinely clears
that mark. `domain/scoring.py` has no such ceiling — only `<= 0.0` is a
DNF — and the stats page must agree with it.
"""

from backend.db import crud, models, schemas
from backend.services.stats import compute_race_stats
from backend.tests.helpers import as_lanes


def _race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Slow Derby",
            organization_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


def _racers(db, race, count):
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(n),
                car_number=n,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for n in range(1, count + 1)
    ]


def _heat_with(db, race, lane_rows, heat_number=1) -> models.Heat:
    """One official heat holding exactly these lanes."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=heat_number)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        kind=models.HeatKind.OFFICIAL,
        heat_number=heat_number,
    )
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lane_rows))
    db.commit()
    return heat


def test_a_genuine_slow_finish_ranks_as_a_finish_not_a_dnf(db):
    """The issue's own repro, run through the real pipeline.

    A racer whose only heat took a genuine 12.0s (a long track, a slow
    rocket) must show up with a real ``min_time``/``max_time``/``mean_time``
    of 12.0 — not the DNF penalty, and not ``None``. A second racer's
    ordinary 3.0s finish keeps the lane statistics honest so a fix that
    merely stopped tracking DNFs at all would still be caught: lane 1 should
    average the genuine 12.0s finish it actually saw, not exclude it.
    """
    race = _race(db)
    racers = _racers(db, race, 2)

    heat = _heat_with(
        db,
        race,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 12.0, "place": 2},
            {"lane": 2, "racer_id": racers[1].id, "time": 3.0, "place": 1},
        ],
    )
    assert heat is not None

    stats = compute_race_stats(db, race.id)
    assert stats is not None

    racer_stats = {rs["racer_id"]: rs for rs in stats["racer_stats"]}
    slow_racer = racer_stats[racers[0].id]

    # The bug: `t < DNF_PENALTY` (9.999) treated 12.0 as "not a real time",
    # so `valid` was empty and `min_time` fell back to the DNF sentinel while
    # `max_time` (which never filtered) still reported the genuine 12.0 —
    # min > 0 but less than max for a racer with exactly one heat, which
    # cannot happen for a real result.
    assert slow_racer["min_time"] == 12.0
    assert slow_racer["max_time"] == 12.0
    assert slow_racer["mean_time"] == 12.0

    # Lane stats: `_compute_lane_stats` excluded any time >= 9.999 from a
    # lane's average, so lane 1's only recorded time (12.0) was dropped and
    # `avg_time` came back `None` despite a heat having actually run there.
    lane_stats = {ls["lane"]: ls for ls in stats["lane_stats"]}
    assert lane_stats[1]["avg_time"] == 12.0
    assert lane_stats[1]["heat_count"] == 1


def test_a_real_dnf_is_still_excluded_as_no_time(db):
    """The other half of the same rule: an actual DNF (time <= 0) still
    contributes no `min`/`max`/`mean` beyond the TIMED penalty, and still
    counts as nothing for lane fairness — #754's fix must not weaken this.
    """
    race = _race(db)
    racers = _racers(db, race, 2)

    _heat_with(
        db,
        race,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 0.0, "place": None},
            {"lane": 2, "racer_id": racers[1].id, "time": 3.0, "place": 1},
        ],
    )

    stats = compute_race_stats(db, race.id)
    assert stats is not None

    racer_stats = {rs["racer_id"]: rs for rs in stats["racer_stats"]}
    dnf_racer = racer_stats[racers[0].id]

    # A lone DNF has no valid time at all: min/max/mean all fall back to the
    # TIMED penalty value, per the module's existing (unchanged) rule.
    assert dnf_racer["min_time"] == 9.999
    assert dnf_racer["max_time"] == 9.999
    assert dnf_racer["mean_time"] == 9.999

    # A DNF never counts toward lane fairness.
    lane_stats = {ls["lane"]: ls for ls in stats["lane_stats"]}
    assert lane_stats[1]["avg_time"] is None
