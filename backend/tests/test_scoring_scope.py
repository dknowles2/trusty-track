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
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Scope Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Scope Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Scope Race",
            organization_id=group.id,
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
    # Checked in, because advancement only considers checked-in racers (#228)
    # and these two are meant to qualify.
    fast = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Fast",
            last_name="F",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )
    slow = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="Slow",
            last_name="S",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )

    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(db, race, prelim, [_lane(1, fast.id, 3.0, 1), _lane(2, slow.id, 4.0, 2)])

    champ = crud.create_round(db, race_id=race.id, round_number=2)
    champ.advancement_source = "ALL"
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

    `ALL` advancement reads the standings. If championship results counted, a
    final-round time would change who was supposed to be *in* the final — and
    advancement is re-run on every recorded result.
    """
    race, fast, slow, _prelim, champ = _build_race_with_championship(db)

    before = scoring.get_advancing_racers(db, race.id, "ALL", 1)
    assert before == [fast.id]

    _heat(db, race, champ, [_lane(1, fast.id, 9.0, 2), _lane(2, slow.id, 2.0, 1)])

    after = scoring.get_advancing_racers(db, race.id, "ALL", 1)
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
    champ.advancement_source = "ALL"
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
    champ.advancement_source = "ALL"
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


# `_grand_final_exclusions` (#548) drops a decided championship round's
# rank-1 racer(s) from the standings the round's field was drawn from, when
# `Race.exclude_round_winners_from_qualifying_standings` is on. The bulk of
# it — the "ALL" and "ROUND:<id>" source kinds, an undecided round excluding
# nobody, a correction restoring the champion — already has coverage in
# `test_excluded_from_standings.py`'s `TestGrandFinalsWinnerExclusion`. Two
# cases that function itself reads a scope for were left untested there,
# because `_build_race_with_championship` above (and its mirror in that
# file) only ever produces an `"ALL"` or `"ROUND:<id>"` source:
#
# - A tie for rank 1 in the championship round. `_grand_final_exclusions`
#   reads `entry.get("rank") == 1` rather than the first row, specifically so
#   a shared rank (#226) excludes every co-champion — not just whichever one
#   happened to sort first.
# - `"EACH_GROUP"`, which is #548's own motivating scenario ("a Grand
#   Finals pack champion does not also keep their own den's trophy"). Its
#   exclusion scope is the aggregate prelim standings (`round_id=None`), the
#   same scope `_standings_for` reads when it picks an `EACH_GROUP` field —
#   not each den's own page.
def _build_race_with_each_group_championship(db):
    """Two racing groups, a winner from each qualifying to one championship
    round drawn `EACH_GROUP` — mirrors `_build_race_with_championship`'s
    shape, but the field is two dens' winners rather than the whole pack's
    top two."""
    race = _seed(db)
    wolves = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves"), race.id
    )
    bears = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Bears"), race.id
    )
    fast_wolf = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="FastWolf",
            last_name="W",
            race_id=race.id,
            racing_group_id=wolves.id,
            car_passed_inspection=True,
        ),
    )
    slow_wolf = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="SlowWolf",
            last_name="W",
            race_id=race.id,
            racing_group_id=wolves.id,
            car_passed_inspection=True,
        ),
    )
    fast_bear = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="FastBear",
            last_name="B",
            race_id=race.id,
            racing_group_id=bears.id,
            car_passed_inspection=True,
        ),
    )
    slow_bear = crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name="SlowBear",
            last_name="B",
            race_id=race.id,
            racing_group_id=bears.id,
            car_passed_inspection=True,
        ),
    )

    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(
        db,
        race,
        prelim,
        [_lane(1, fast_wolf.id, 3.0, 1), _lane(2, slow_wolf.id, 4.0, 2)],
        heat_number=1,
    )
    _heat(
        db,
        race,
        prelim,
        [_lane(1, fast_bear.id, 3.5, 1), _lane(2, slow_bear.id, 5.0, 2)],
        heat_number=2,
    )

    champ = crud.create_round(db, race_id=race.id, round_number=2)
    champ.advancement_source = "EACH_GROUP"
    champ.advancement_num_racers = 1
    db.commit()

    return race, fast_wolf, fast_bear, prelim, champ


def test_the_each_group_champion_stops_counting_toward_the_pack_standings(db):
    """#548's actual scenario: the two den winners race each other in the
    final, and whoever wins it (the pack champion) no longer also holds
    their own den's trophy on the overall pack standings — while the
    runner-up, who only won their den, still does."""
    race, fast_wolf, fast_bear, _prelim, champ = (
        _build_race_with_each_group_championship(db)
    )
    race.exclude_round_winners_from_qualifying_standings = True
    db.commit()

    # The Wolves' champion wins the final outright.
    _heat(
        db,
        race,
        champ,
        [_lane(1, fast_wolf.id, 2.0, 1), _lane(2, fast_bear.id, 3.0, 2)],
    )

    standings = scoring.get_leaderboard(db, race.id)
    ids = [s["racer_id"] for s in standings]
    assert fast_wolf.id not in ids, (
        "the pack champion should no longer also hold their own den's trophy"
    )
    assert fast_bear.id in ids, (
        "the runner-up in the final still holds their own den's trophy"
    )


def test_an_each_group_final_reads_the_aggregate_scope_not_each_den(db):
    """`_grand_final_exclusions` computes the EACH_GROUP exclusion once, at
    the aggregate prelim scope (round_id=None) — the same scope
    `_standings_for` reads when it picks an EACH_GROUP field. A den's own
    round-scoped page is untouched by it, the same asymmetry the "ROUND:<id>"
    case already pins against the aggregate view."""
    race, fast_wolf, fast_bear, prelim, champ = (
        _build_race_with_each_group_championship(db)
    )
    race.exclude_round_winners_from_qualifying_standings = True
    db.commit()
    _heat(
        db,
        race,
        champ,
        [_lane(1, fast_wolf.id, 2.0, 1), _lane(2, fast_bear.id, 3.0, 2)],
    )

    # The prelim round's own page is scored `round_id=prelim.id`, not the
    # `round_id=None` scope EACH_GROUP's field was drawn from — the pack
    # champion still shows up racing their den's own prelim heat.
    round_standings = scoring.get_leaderboard(db, race.id, round_id=prelim.id)
    assert fast_wolf.id in [s["racer_id"] for s in round_standings]


def test_a_tie_for_first_in_the_final_excludes_every_co_champion(db):
    """A tie shares a rank (#226) — `_grand_final_exclusions` reads
    `rank == 1` rather than the first row of the leaderboard, so a dead heat
    for the championship excludes every co-champion together rather than
    whichever one happened to sort first."""
    race, fast, slow, _prelim, champ = _build_race_with_championship(db)
    race.exclude_round_winners_from_qualifying_standings = True
    db.commit()

    # Fast and Slow cross the line together in the final.
    _heat(db, race, champ, [_lane(1, fast.id, 3.0, 1), _lane(2, slow.id, 3.0, 1)])

    standings = scoring.get_leaderboard(db, race.id)
    ids = [s["racer_id"] for s in standings]
    assert fast.id not in ids, (
        "a co-champion must be excluded, not just whichever sorts first"
    )
    assert slow.id not in ids, (
        "a co-champion must be excluded, not just whichever sorts first"
    )
