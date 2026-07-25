"""Tests for the request-scoped loader cache.

The cache exists to collapse N+1 queries, but a cache attached to a long-lived
subscription context is exactly how you end up showing a stale leaderboard to a
room full of parents. These tests pin the invalidation behaviour.
"""

import json

from backend.api.loaders import RequestLoaders
from backend.db import crud, models, schemas


def _seed(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Loader Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Loader Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(name="Loader Race", group_id=group.id, track_id=track.id),
    )
    return race


def test_repeated_reads_hit_the_cache(db):
    """The whole point: the second read must not query again."""
    race = _seed(db)
    den = models.Den(name="Wolves", race_id=race.id)
    db.add(den)
    db.commit()

    loaders = RequestLoaders(db)
    first = loaders.dens_for_race(race.id)
    second = loaders.dens_for_race(race.id)
    assert first is second, "expected the identical cached list object"


def test_clear_forces_a_reread(db):
    """After clear(), new rows become visible."""
    race = _seed(db)
    loaders = RequestLoaders(db)
    assert loaders.dens_for_race(race.id) == []

    db.add(models.Den(name="Bears", race_id=race.id))
    db.commit()

    loaders.clear()
    assert [d.name for d in loaders.dens_for_race(race.id)] == ["Bears"]


def test_commit_invalidates_the_cache(db):
    """A commit through the same session drops cached data automatically.

    This is the backstop for subscription contexts: even if a resolver forgets
    to call clear(), a write through this session will not leave the cache
    serving pre-write data.
    """
    race = _seed(db)
    loaders = RequestLoaders(db)
    assert loaders.dens_for_race(race.id) == []

    db.add(models.Den(name="Lions", race_id=race.id))
    db.commit()  # should fire after_commit -> clear()

    assert [d.name for d in loaders.dens_for_race(race.id)] == ["Lions"]


def test_leaderboard_reflects_new_results_after_clear(db):
    """A stale leaderboard is the worst-case failure mode; make sure it isn't."""
    race = _seed(db)
    racer_a = crud.create_racer(
        db, schemas.RacerCreate(first_name="Ann", last_name="A", race_id=race.id)
    )
    racer_b = crud.create_racer(
        db, schemas.RacerCreate(first_name="Bob", last_name="B", race_id=race.id)
    )
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=1,
        lane_results=json.dumps(
            [
                {"lane": 1, "racer_id": racer_a.id, "time": 4.0, "place": 2},
                {"lane": 2, "racer_id": racer_b.id, "time": 3.0, "place": 1},
            ]
        ),
    )
    db.add(heat)
    db.commit()

    loaders = RequestLoaders(db)
    assert loaders.leaderboard(race.id)[0]["racer_id"] == racer_b.id

    # Ann posts a much better time; the order should flip.
    heat.lane_results = json.dumps(
        [
            {"lane": 1, "racer_id": racer_a.id, "time": 2.0, "place": 1},
            {"lane": 2, "racer_id": racer_b.id, "time": 3.0, "place": 2},
        ]
    )
    db.commit()

    assert loaders.leaderboard(race.id)[0]["racer_id"] == racer_a.id


def test_global_heat_numbers_span_rounds(db):
    """Global numbering must be continuous across rounds, in race order."""
    race = _seed(db)
    heat_ids = []
    for round_number in (1, 2):
        round_obj = crud.create_round(db, race_id=race.id, round_number=round_number)
        for heat_number in (1, 2):
            heat = models.Heat(
                race_id=race.id,
                round_id=round_obj.id,
                heat_number=heat_number,
                lane_results=None,
            )
            db.add(heat)
            db.commit()
            heat_ids.append(heat.id)

    loaders = RequestLoaders(db)
    numbers = [loaders.global_heat_number(race.id, hid) for hid in heat_ids]
    assert numbers == [1, 2, 3, 4]
