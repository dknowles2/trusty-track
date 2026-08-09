"""Standings cover prelim rounds only — issue #17.

Before this, `get_leaderboard` with no round_id averaged *every* heat in the
race, so championship results blended into prelim averages. That was never a
decision, just what the code happened to do, and no test pinned it either way.

The circularity is the real problem: a championship field is chosen from the
standings, and `crud.record_heat_result` re-runs advancement on every result, so
a championship time could move the leaderboard that had picked the championship
field.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import scoring as domain_scoring
from backend.services import scoring
from backend.tests.helpers import as_lanes


def _seed(db, scoring_strategy=models.ScoringStrategy.TIMED):
    group = crud.create_group(db, schemas.GroupCreate(name="Scope Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Scope Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Scope Race",
            group_id=group.id,
            track_id=track.id,
            scoring_strategy=scoring_strategy,
        ),
    )
    return race


def _heat(db, race, round_obj, lanes, heat_number=1):
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        heat_number=heat_number,
    )
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lanes))
    db.commit()
    return heat


def _lane(lane, racer_id, time=None, place=None):
    return {"lane": lane, "racer_id": racer_id, "time": time, "place": place}


def _build_race_with_championship(db):
    """Two racers, a prelim round, and a championship round they both reach."""
    race = _seed(db)
    fast = crud.create_racer(
        db, schemas.RacerCreate(first_name="Fast", last_name="F", race_id=race.id)
    )
    slow = crud.create_racer(
        db, schemas.RacerCreate(first_name="Slow", last_name="S", race_id=race.id)
    )

    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(db, race, prelim, [_lane(1, fast.id, 3.0, 1), _lane(2, slow.id, 4.0, 2)])

    champ = crud.create_round(db, race_id=race.id, round_number=2)
    champ.advancement_source = "PACK"
    champ.advancement_num_racers = 2
    db.commit()

    return race, fast, slow, prelim, champ


def test_championship_results_do_not_move_the_standings(db):
    """The headline behaviour change."""
    race, fast, slow, _prelim, champ = _build_race_with_championship(db)

    standings = scoring.get_leaderboard(db, race.id)
    assert [s["racer_id"] for s in standings] == [fast.id, slow.id]

    # Slow has a blinder in the final; Fast has a shocker.
    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    standings = scoring.get_leaderboard(db, race.id)
    assert [s["racer_id"] for s in standings] == [fast.id, slow.id], (
        "prelim standings must not move when a championship heat is recorded"
    )
    assert standings[0]["score"] == 3.0, "score should still be the prelim time alone"


def test_include_all_rounds_restores_the_old_blend(db):
    """The pre-#17 answer is still reachable, just no longer the default."""
    race, fast, slow, _prelim, champ = _build_race_with_championship(db)
    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    blended = scoring.get_leaderboard(db, race.id, scope=domain_scoring.ALL)
    assert [s["racer_id"] for s in blended] == [slow.id, fast.id]
    assert blended[0]["score"] == pytest.approx(3.0)  # slow: (4.0 + 2.0) / 2
    assert blended[1]["score"] == pytest.approx(6.0)  # fast: (3.0 + 9.0) / 2


def test_a_single_round_is_still_scoped_to_that_round(db):
    """This is how the UI shows championship results."""
    race, fast, slow, prelim, champ = _build_race_with_championship(db)
    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    champ_standings = scoring.get_leaderboard(db, race.id, round_id=champ.id)
    assert [s["racer_id"] for s in champ_standings] == [slow.id, fast.id]
    assert champ_standings[0]["score"] == 2.0

    prelim_standings = scoring.get_leaderboard(db, race.id, round_id=prelim.id)
    assert [s["racer_id"] for s in prelim_standings] == [fast.id, slow.id]


def test_advancement_is_decided_on_prelims_alone(db):
    """The feedback loop, closed.

    `PACK` advancement reads the standings. If championship results counted, a
    final-round time would change who was supposed to be *in* the final — and
    advancement is re-run on every recorded result.
    """
    race, fast, slow, _prelim, champ = _build_race_with_championship(db)

    before = scoring.get_advancing_racers(db, race.id, "PACK", 1)
    assert before == [fast.id]

    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    after = scoring.get_advancing_racers(db, race.id, "PACK", 1)
    assert after == [fast.id], (
        "who advances must not depend on results from the round they advance into"
    )


def test_points_scoring_is_scoped_the_same_way(db):
    """POINTS sums placements, so an extra round adds to every racer's total."""
    race = _seed(db, scoring_strategy=models.ScoringStrategy.POINTS)
    a = crud.create_racer(
        db, schemas.RacerCreate(first_name="A", last_name="A", race_id=race.id)
    )
    b = crud.create_racer(
        db, schemas.RacerCreate(first_name="B", last_name="B", race_id=race.id)
    )
    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(db, race, prelim, [_lane(1, a.id, 3.0, 1), _lane(2, b.id, 4.0, 2)])

    champ = crud.create_round(db, race_id=race.id, round_number=2)
    champ.advancement_source = "PACK"
    champ.advancement_num_racers = 2
    db.commit()
    _heat(db, race, champ, [_lane(1, a.id, 3.0, 2), _lane(2, b.id, 4.0, 1)])

    standings = scoring.get_leaderboard(db, race.id)
    assert standings[0]["racer_id"] == a.id
    assert standings[0]["score"] == 1, "only the prelim placement should count"


def test_a_race_with_no_prelim_rounds_falls_back_to_every_heat(db):
    """Degenerate setup — better than showing empty standings on a run race."""
    race = _seed(db)
    racer = crud.create_racer(
        db, schemas.RacerCreate(first_name="Only", last_name="One", race_id=race.id)
    )
    champ = crud.create_round(db, race_id=race.id, round_number=1)
    champ.advancement_source = "PACK"
    champ.advancement_num_racers = 1
    db.commit()
    _heat(db, race, champ, [_lane(1, racer.id, 3.5, 1)])

    standings = scoring.get_leaderboard(db, race.id)
    assert [s["racer_id"] for s in standings] == [racer.id]
    assert standings[0]["score"] == 3.5


def test_a_race_with_no_championship_rounds_is_unaffected(db):
    """Most races. The change must be a no-op for them."""
    race = _seed(db)
    a = crud.create_racer(
        db, schemas.RacerCreate(first_name="A", last_name="A", race_id=race.id)
    )
    b = crud.create_racer(
        db, schemas.RacerCreate(first_name="B", last_name="B", race_id=race.id)
    )
    r1 = crud.create_round(db, race_id=race.id, round_number=1)
    r2 = crud.create_round(db, race_id=race.id, round_number=2)
    _heat(db, race, r1, [_lane(1, a.id, 3.0, 1), _lane(2, b.id, 4.0, 2)])
    _heat(db, race, r2, [_lane(1, a.id, 3.4, 1), _lane(2, b.id, 4.4, 2)])

    default = scoring.get_leaderboard(db, race.id)
    everything = scoring.get_leaderboard(db, race.id, scope=domain_scoring.ALL)
    assert default == everything


def test_the_loader_cache_keys_on_scope(db):
    """Prelim and all-heats standings are different answers, not one cached one."""
    from backend.api.loaders import RequestLoaders

    race, fast, slow, _prelim, champ = _build_race_with_championship(db)
    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    loaders = RequestLoaders(db)
    prelim_only = loaders.leaderboard(race.id)
    blended = loaders.leaderboard(race.id, scope=domain_scoring.ALL)
    assert [s["racer_id"] for s in prelim_only] == [fast.id, slow.id]
    assert [s["racer_id"] for s in blended] == [slow.id, fast.id]


def test_a_tie_shares_a_rank_on_the_leaderboard(db):
    """#226. Equal scores used to be stamped 1 and 2 — gold and silver decided
    by registration order, with nothing on any screen saying a tie happened."""
    race = _seed(db)
    a = crud.create_racer(
        db, schemas.RacerCreate(first_name="A", last_name="A", race_id=race.id)
    )
    b = crud.create_racer(
        db, schemas.RacerCreate(first_name="B", last_name="B", race_id=race.id)
    )
    c = crud.create_racer(
        db, schemas.RacerCreate(first_name="C", last_name="C", race_id=race.id)
    )
    r1 = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(
        db,
        race,
        r1,
        [_lane(1, a.id, 3.0, 1), _lane(2, b.id, 3.0, 1)],
    )
    _heat(
        db,
        race,
        r1,
        [_lane(1, c.id, 4.0, 1)],
        heat_number=2,
    )

    standings = scoring.get_leaderboard(db, race.id)

    assert [s["rank"] for s in standings] == [1, 1, 3]
