"""A car can race and not be ranked (#548).

``Racer.excluded_from_standings`` and
``Race.exclude_round_winners_from_qualifying_standings`` are both read in
exactly one place, ``services/scoring.get_leaderboard`` (and its
elimination-round sibling ``_elimination_leaderboard``) — everything
downstream (advancement, awards, the CSV and results-sheet exports) inherits
the exclusion for free. This file pins that it actually does: "falls out for
free" is how #52 ended up with five copies of a rule that should have had
one.
"""

from backend.db import crud, models, schemas
from backend.services import awards as awards_service
from backend.services import records as records_service
from backend.services import scoring
from backend.tests.helpers import as_lanes


def _seed(db, scoring_strategy=models.ScoringStrategy.TIMED):
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name="Excl Pack")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name="Excl Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Excl Race",
            organization_id=organization.id,
            track_id=track.id,
            scoring_strategy=scoring_strategy,
        ),
    )
    return race, track


def _racer(db, race, *, first_name, excluded=False):
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=first_name,
            last_name="Excl",
            race_id=race.id,
            car_passed_inspection=True,
            excluded_from_standings=excluded,
        ),
    )


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


class TestRacerLevelExclusion:
    def test_excluded_racer_is_dropped_from_the_leaderboard(self, db):
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        scout = _racer(db, race, first_name="Scout")
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        _heat(
            db,
            race,
            prelim,
            [_lane(1, sibling.id, 2.0, 1), _lane(2, scout.id, 4.0, 2)],
        )

        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [scout.id]

    def test_excluded_racer_cannot_advance(self, db):
        """`get_advancing_racers` never hands the flagged car a championship
        slot — it must not take one from a ranked car (#548)."""
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        scout = _racer(db, race, first_name="Scout")
        slow = _racer(db, race, first_name="Slow")
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        _heat(
            db,
            race,
            prelim,
            [_lane(1, sibling.id, 1.0, 1), _lane(2, scout.id, 2.0, 2)],
        )
        _heat(db, race, prelim, [_lane(1, slow.id, 5.0, 1)], heat_number=2)

        advancing = scoring.get_advancing_racers(db, race.id, "ALL", 1)
        assert advancing == [scout.id], (
            "the fastest *ranked* car should advance, not the flagged sibling"
        )

    def test_excluded_racer_cannot_win_a_speed_award(self, db):
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        scout = _racer(db, race, first_name="Scout")
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        _heat(
            db,
            race,
            prelim,
            [_lane(1, sibling.id, 1.0, 1), _lane(2, scout.id, 3.0, 2)],
        )

        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Car", kind=models.AwardKind.SPEED, source="ALL", place=1
            ),
        )
        assert awards_service.recipients_for(db, race.id)[award.id] == scout.id

    def test_excluded_racer_still_sets_a_track_record(self, db):
        """`services/records.py` is about the track, not the standings (#548)
        — deliberately unfiltered."""
        race, track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        _heat(db, race, prelim, [_lane(1, sibling.id, 1.5, 1)])

        records = records_service.track_records(db, track.id)
        holders = {(r.racer_name, r.time_seconds) for r in records}
        assert ("Sibling Excl", 1.5) in holders

    def test_excluded_racer_is_dropped_from_an_elimination_round(self, db):
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        scout = _racer(db, race, first_name="Scout")
        elim = crud.create_round(
            db,
            race_id=race.id,
            round_number=1,
            scheduling_strategy=models.SchedulingStrategy.ELIMINATION,
            elimination_losses=1,
        )
        # Scout wins the only heat; sibling takes the loss.
        _heat(
            db,
            race,
            elim,
            [_lane(1, scout.id, 1.0, 1), _lane(2, sibling.id, 2.0, 2)],
        )

        standings = scoring.get_leaderboard(db, race.id, round_id=elim.id)
        assert [s["racer_id"] for s in standings] == [scout.id]

    def test_drop_worst_run_ignores_an_excluded_racers_own_heat_count(self, db):
        """The excluded racer's own irregular participation must not disable
        the modifier for the ranked field (#548).

        `domain.scoring.drop_worst_status` only drops a run when *every*
        racer in the heats it is given has the same, sufficient, count. If
        an excluded racer's lanes were left in that population, a lone
        exhibition car racing an odd number of heats would silently turn
        the setting off for everybody else too.
        """
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        a = _racer(db, race, first_name="A")
        b = _racer(db, race, first_name="B")
        race.drop_worst_runs = 1
        db.commit()

        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        # A and B each race three heats with equal counts; the excluded
        # sibling races a single heat — an uneven count that would sink
        # `drop_worst_status`'s evenness check if it were still in the mix.
        _heat(db, race, prelim, [_lane(1, a.id, 3.0, 1), _lane(2, b.id, 5.0, 2)], 1)
        _heat(db, race, prelim, [_lane(1, a.id, 4.0, 1), _lane(2, b.id, 6.0, 2)], 2)
        _heat(db, race, prelim, [_lane(1, a.id, 9.0, 1), _lane(2, b.id, 1.0, 2)], 3)
        _heat(db, race, prelim, [_lane(1, sibling.id, 2.0, 1)], 4)

        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [b.id, a.id]
        assert all(s["drop_worst_runs_applied"] for s in standings)
        # A's worst (highest) time, 9.0, is dropped: average of 3.0 and 4.0.
        a_row = next(s for s in standings if s["racer_id"] == a.id)
        assert a_row["score"] == 3.5
        # B's worst, 6.0, is dropped: average of 5.0 and 1.0.
        b_row = next(s for s in standings if s["racer_id"] == b.id)
        assert b_row["score"] == 3.0

    def test_a_tie_between_ranked_racers_ignores_an_excluded_racers_score(self, db):
        """#540's tiebreak chain must not let an excluded racer join, or
        settle, a tie it was never a contender in (#548)."""
        race, _track = _seed(db, scoring_strategy=models.ScoringStrategy.TIMED)
        race.tiebreaker = models.TiebreakMethod.BEST_TIME
        db.commit()
        a = _racer(db, race, first_name="A")
        b = _racer(db, race, first_name="B")
        # Would out-qualify both A and B on fastest single heat if counted.
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        _heat(db, race, prelim, [_lane(1, a.id, 3.0, 1)], 1)
        _heat(db, race, prelim, [_lane(1, a.id, 3.0, 1)], 2)
        _heat(db, race, prelim, [_lane(1, b.id, 2.0, 1)], 3)
        _heat(db, race, prelim, [_lane(1, b.id, 4.0, 1)], 4)
        _heat(db, race, prelim, [_lane(1, sibling.id, 1.0, 1)], 5)
        _heat(db, race, prelim, [_lane(1, sibling.id, 5.0, 1)], 6)

        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [b.id, a.id], (
            "B's fastest single heat (2.0) should settle the tie with A "
            "(both average 3.0) — the excluded sibling, whose 1.0 would "
            "otherwise win the tiebreak outright, must not take part"
        )
        assert {s["resolved_by"] for s in standings} == {"BEST_TIME"}

    def test_still_races_and_still_counts_toward_heat_generation(self, db):
        """The flag never touches scheduling — check-in remains the trigger
        for who is in a heat (#548)."""
        race, _track = _seed(db)
        sibling = _racer(db, race, first_name="Sibling", excluded=True)
        scout = _racer(db, race, first_name="Scout")
        prelim = crud.create_round(db, race_id=race.id, round_number=1)
        crud.generate_heats_for_round(db, prelim.id)

        scheduled = set()
        for heat in crud.get_heats(db, race.id, round_id=prelim.id):
            for lane in crud.heat_lanes_of(db, heat):
                if lane.racer_id is not None:
                    scheduled.add(lane.racer_id)
        assert sibling.id in scheduled
        assert scout.id in scheduled


def _build_race_with_championship(db, source_kind="ALL"):
    """Two racers in a prelim round, and a championship round they both reach.

    Mirrors ``test_scoring_scope._build_race_with_championship``. The
    ``source_kind`` switch exercises #548's two matched scopes:
    ``"ALL"`` names the aggregate prelim standings (``round_id=None``, the
    default "Overall" view), and ``"ROUND"`` names the prelim round itself.
    """
    race, _track = _seed(db)
    fast = _racer(db, race, first_name="Fast")
    slow = _racer(db, race, first_name="Slow")
    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    _heat(db, race, prelim, [_lane(1, fast.id, 3.0, 1), _lane(2, slow.id, 4.0, 2)])

    champ = crud.create_round(db, race_id=race.id, round_number=2)
    champ.advancement_source = "ALL" if source_kind == "ALL" else f"ROUND:{prelim.id}"
    champ.advancement_num_racers = 2
    db.commit()
    return race, fast, slow, prelim, champ


class TestGrandFinalsWinnerExclusion:
    def test_off_by_default(self, db):
        race, fast, slow, _prelim, champ = _build_race_with_championship(db)
        # Fast wins the final too, and nothing excludes them.
        _heat(db, race, champ, [_lane(1, fast.id, 2.0, 1), _lane(2, slow.id, 5.0, 2)])

        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [fast.id, slow.id]

    def test_the_champion_stops_counting_toward_the_aggregate_they_qualified_from(
        self, db
    ):
        race, fast, slow, _prelim, champ = _build_race_with_championship(
            db, source_kind="ALL"
        )
        race.exclude_round_winners_from_qualifying_standings = True
        db.commit()

        # Not yet decided: nobody is excluded.
        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [fast.id, slow.id]

        _heat(db, race, champ, [_lane(1, fast.id, 2.0, 1), _lane(2, slow.id, 5.0, 2)])

        standings = scoring.get_leaderboard(db, race.id)
        assert [s["racer_id"] for s in standings] == [slow.id], (
            "the pack champion should no longer also hold the den trophy"
        )

    def test_the_champion_stops_counting_toward_the_named_round_but_not_the_aggregate(
        self, db
    ):
        race, fast, slow, prelim, champ = _build_race_with_championship(
            db, source_kind="ROUND"
        )
        race.exclude_round_winners_from_qualifying_standings = True
        db.commit()
        _heat(db, race, champ, [_lane(1, fast.id, 2.0, 1), _lane(2, slow.id, 5.0, 2)])

        round_standings = scoring.get_leaderboard(db, race.id, round_id=prelim.id)
        assert [s["racer_id"] for s in round_standings] == [slow.id]

        # `"ROUND:<id>"` names that round's own standings, not the aggregate
        # default view — the two only ever agree when there is exactly one
        # prelim round in the race.
        aggregate = scoring.get_leaderboard(db, race.id)
        assert fast.id in [s["racer_id"] for s in aggregate]

    def test_a_correction_that_undecides_the_final_restores_the_champion(self, db):
        race, fast, slow, _prelim, champ = _build_race_with_championship(
            db, source_kind="ALL"
        )
        race.exclude_round_winners_from_qualifying_standings = True
        db.commit()
        heat = _heat(
            db, race, champ, [_lane(1, fast.id, 2.0, 1), _lane(2, slow.id, 5.0, 2)]
        )
        assert fast.id not in [
            s["racer_id"] for s in scoring.get_leaderboard(db, race.id)
        ]

        # Clear the result: the final is no longer decided, so #17's rule
        # applies here exactly as it does to a corrected time — the answer
        # moves on the very next read.
        crud.set_heat_lanes(heat, as_lanes([_lane(1, fast.id), _lane(2, slow.id)]))
        db.commit()

        standings = scoring.get_leaderboard(db, race.id)
        assert fast.id in [s["racer_id"] for s in standings]

    def test_an_elimination_final_is_not_covered(self, db):
        """An elimination round's "winner" is whoever survives, not a rank-1
        leaderboard row — #548 does not ask for that format to be covered."""
        race, fast, slow, _prelim, champ = _build_race_with_championship(
            db, source_kind="ALL"
        )
        champ.scheduling_strategy = models.SchedulingStrategy.ELIMINATION
        champ.elimination_losses = 1
        race.exclude_round_winners_from_qualifying_standings = True
        db.commit()
        _heat(db, race, champ, [_lane(1, fast.id, 2.0, 1), _lane(2, slow.id, 5.0, 2)])

        standings = scoring.get_leaderboard(db, race.id)
        assert fast.id in [s["racer_id"] for s in standings]
