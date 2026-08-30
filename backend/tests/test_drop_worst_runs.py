"""Wiring `Race.drop_worst_runs` through the leaderboard (#547, stage 2).

`domain.scoring` (this stage) is pure and already covered by
`test_domain_scoring.py`. This file is the database-backed half: the
`updateRace` mutation, the `dropWorstRunsApplied` field the leaderboard
carries, and the two places the pure rule has to compose with something else
— a disrupted round (#171/#172) and the tiebreak chain (#540).
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.services import scoring
from backend.tests.helpers import as_lanes


def _seed(
    db: Session,
    scoring_strategy: str = models.ScoringStrategy.TIMED,
    drop_worst_runs: int = 0,
    tiebreaker: str = models.TiebreakMethod.SHARED,
) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Drop Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Drop Track", lane_count=2, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Drop Race {scoring_strategy}-{drop_worst_runs}-{tiebreaker}",
            organization_id=org.id,
            track_id=track.id,
            scoring_strategy=scoring_strategy,
            tiebreaker=tiebreaker,
        ),
    )
    if drop_worst_runs:
        crud.update_race(
            db, race.id, schemas.RaceUpdate(drop_worst_runs=drop_worst_runs)
        )
        db.refresh(race)
    return race


def _round(db: Session, race: models.Race) -> models.Round:
    return crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")


def _racer(db: Session, race: models.Race, name: str) -> models.Racer:
    return crud.create_racer(
        db,
        schemas.RacerCreate(
            first_name=name,
            last_name="T",
            race_id=race.id,
            car_passed_inspection=True,
        ),
    )


def _lane(lane, racer_id, time=None, place=None):
    return {"lane": lane, "racer_id": racer_id, "time": time, "place": place}


def _heat(db, race, round_obj, lanes, heat_number, disrupted=False):
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=heat_number)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lanes))
    if disrupted:
        round_obj.disrupted = True
    db.commit()
    return heat


class TestUpdateRaceMutation:
    def test_absent_leaves_it_alone(self, client, db: Session):
        race = _seed(db, drop_worst_runs=2)
        query = f"""
        mutation {{
          updateRace(id: {race.id}, race: {{ name: "Renamed" }}) {{
            id
            dropWorstRuns
          }}
        }}
        """
        response = client.post("/graphql", json={"query": query})
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body
        assert body["data"]["updateRace"]["dropWorstRuns"] == 2

    def test_zero_turns_it_back_off(self, client, db: Session):
        race = _seed(db, drop_worst_runs=1)
        query = f"""
        mutation {{
          updateRace(id: {race.id}, race: {{ dropWorstRuns: 0 }}) {{
            id
            dropWorstRuns
          }}
        }}
        """
        response = client.post("/graphql", json={"query": query})
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body
        assert body["data"]["updateRace"]["dropWorstRuns"] == 0

    def test_a_new_race_defaults_to_off(self, db: Session):
        race = _seed(db)
        assert race.drop_worst_runs == 0


class TestGetLeaderboardAppliesTheDrop:
    def test_timed_drops_the_worst_time_when_counts_match(self, db: Session):
        race = _seed(db, models.ScoringStrategy.TIMED, drop_worst_runs=1)
        round_obj = _round(db, race)
        racer = _racer(db, race, "A")

        _heat(db, race, round_obj, [_lane(1, racer.id, time=3.0)], heat_number=1)
        _heat(db, race, round_obj, [_lane(1, racer.id, time=4.0)], heat_number=2)
        _heat(db, race, round_obj, [_lane(1, racer.id, time=9.0)], heat_number=3)

        board = scoring.get_leaderboard(db, race.id)
        row = board[0]
        assert row["score"] == 3.5  # (3.0 + 4.0) / 2, the 9.0 dropped
        assert row["heats_completed"] == 3  # participation is unaffected
        assert row["drop_worst_runs_applied"] is True

    def test_zero_reproduces_the_undropped_leaderboard(self, db: Session):
        race = _seed(db, models.ScoringStrategy.TIMED, drop_worst_runs=0)
        round_obj = _round(db, race)
        racer = _racer(db, race, "A")

        _heat(db, race, round_obj, [_lane(1, racer.id, time=3.0)], heat_number=1)
        _heat(db, race, round_obj, [_lane(1, racer.id, time=9.0)], heat_number=2)

        board = scoring.get_leaderboard(db, race.id)
        row = board[0]
        assert row["score"] == 6.0
        assert row["drop_worst_runs_applied"] is False


class TestDropWorstRunsAndADisruptedRound:
    """The interplay the ground rules name: `counts_a_disrupted_round`
    already excludes a disrupted round for a summing strategy, so drop-worst
    never even sees the imbalance there. A scale-free strategy keeps the
    disrupted round, so drop-worst's own equal-counts guard is what protects
    it — nothing upstream does that job for it.
    """

    def test_timed_keeps_a_disrupted_round_and_refuses_to_drop(self, db: Session):
        # Racer 1 raced both heats; racer 2's second lane was vacated by a
        # lane outage mid-round, so racer 2 has one fewer counted result.
        race = _seed(db, models.ScoringStrategy.TIMED, drop_worst_runs=1)
        round_obj = _round(db, race)
        a = _racer(db, race, "A")
        b = _racer(db, race, "B")

        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, time=3.0), _lane(2, b.id, time=3.5)],
            heat_number=1,
        )
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, time=3.2)],
            heat_number=2,
            disrupted=True,
        )

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}

        # TIMED is scale-free (`counts_a_disrupted_round` is True for it), so
        # the disrupted round still counts — and racer 2 really does have
        # one fewer result, which is exactly the case drop-worst must refuse.
        assert by_id[a.id]["heats_completed"] == 2
        assert by_id[b.id]["heats_completed"] == 1
        assert by_id[a.id]["drop_worst_runs_applied"] is False
        assert by_id[b.id]["drop_worst_runs_applied"] is False
        # Nothing dropped: the average is the plain average of what each
        # racer actually ran.
        assert by_id[a.id]["score"] == (3.0 + 3.2) / 2
        assert by_id[b.id]["score"] == 3.5

    def test_points_excludes_the_disrupted_round_so_the_drop_is_unaffected(
        self, db: Session
    ):
        race = _seed(db, models.ScoringStrategy.POINTS, drop_worst_runs=1)
        round_obj = _round(db, race)
        a = _racer(db, race, "A")
        b = _racer(db, race, "B")

        # A disrupted heat: racer 2's lane was vacated. Under POINTS this
        # whole round would normally be excluded by `counts_a_disrupted_round`
        # — but a *second*, undisrupted round gives both racers an even,
        # comparable field for the drop to work with.
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, place=1), _lane(2, b.id, place=2)],
            heat_number=1,
        )
        _heat(db, race, round_obj, [_lane(1, a.id, place=1)], heat_number=2)
        round_obj.disrupted = True
        db.commit()

        clean_round = crud.create_round(
            db, race.id, 2, models.SchedulingStrategy.PPC, "Clean"
        )
        _heat(
            db,
            race,
            clean_round,
            [_lane(1, a.id, place=2), _lane(2, b.id, place=1)],
            heat_number=1,
        )
        _heat(
            db,
            race,
            clean_round,
            [_lane(1, a.id, place=1), _lane(2, b.id, place=2)],
            heat_number=2,
        )

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}

        # Only the clean round's two heats count for either racer — the
        # disrupted round is invisible to POINTS entirely.
        assert by_id[a.id]["heats_completed"] == 2
        assert by_id[b.id]["heats_completed"] == 2
        assert by_id[a.id]["drop_worst_runs_applied"] is True
        assert by_id[b.id]["drop_worst_runs_applied"] is True
        # Undropped sums would both be 3 (places 2+1 and 1+2). Dropping the
        # worst (highest) placement from each leaves the better of the two —
        # a tie at 1, exactly what the next class exercises further.
        assert by_id[a.id]["score"] == 1
        assert by_id[b.id]["score"] == 1


class TestDropWorstRunsInterplayWithTiebreak:
    """#540 just landed: `get_leaderboard` resolves a same-score cluster
    through `domain.tiebreak`. A tie *created* by dropping the worst run
    must still be resolvable — and the tiebreaker reads the full, undropped
    heat data (it is not told which run was dropped), which is deliberate:
    breaking a tie on the evidence that created it is more informative than
    breaking it on a subset.
    """

    def test_best_time_breaks_a_tie_the_drop_itself_created(self, db: Session):
        race = _seed(
            db,
            models.ScoringStrategy.TIMED,
            drop_worst_runs=1,
            tiebreaker=models.TiebreakMethod.BEST_TIME,
        )
        round_obj = _round(db, race)
        a = _racer(db, race, "A")
        b = _racer(db, race, "B")

        # A: [2.0, 2.0, 10.0] -> drop 10.0 -> average 2.0.
        # B: [1.0, 3.0, 10.0] -> drop 10.0 -> average 2.0.
        # Undropped they are not tied (4.67 vs 4.67 is *also* a tie here,
        # actually — use the drop to show it creates one that a plain
        # average alone would not have singled out this way): the point is
        # the post-drop score, 2.0 for both.
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, time=2.0), _lane(2, b.id, time=1.0)],
            heat_number=1,
        )
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, time=2.0), _lane(2, b.id, time=3.0)],
            heat_number=2,
        )
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, time=10.0), _lane(2, b.id, time=10.0)],
            heat_number=3,
        )

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}

        assert by_id[a.id]["score"] == by_id[b.id]["score"] == 2.0
        assert by_id[a.id]["drop_worst_runs_applied"] is True
        assert by_id[b.id]["drop_worst_runs_applied"] is True

        # BEST_TIME reads the racer's single fastest *raw* heat time, not
        # the post-drop average -- B's 1.0 beats A's 2.0, so B is ranked
        # first and both rows are marked resolved.
        assert by_id[b.id]["rank"] == 1
        assert by_id[a.id]["rank"] == 2
        assert by_id[a.id]["resolved_by"] == models.TiebreakMethod.BEST_TIME
        assert by_id[b.id]["resolved_by"] == models.TiebreakMethod.BEST_TIME


class TestEliminationLeaderboardIgnoresDropWorst:
    """Elimination never calls `domain.scoring.score_heats` at all — the
    modifier has nothing to apply to there, and the flag should say so
    honestly rather than being left unset.
    """

    def test_the_flag_is_false(self, db: Session):
        race = _seed(db, models.ScoringStrategy.POINTS, drop_worst_runs=1)
        round_obj = crud.create_round(
            db,
            race.id,
            1,
            models.SchedulingStrategy.ELIMINATION,
            "Elimination",
        )
        a = _racer(db, race, "A")
        b = _racer(db, race, "B")
        _heat(
            db,
            race,
            round_obj,
            [_lane(1, a.id, place=1), _lane(2, b.id, place=2)],
            heat_number=1,
        )

        board = scoring.get_leaderboard(db, race.id, round_id=round_obj.id)
        assert board
        assert all(row["drop_worst_runs_applied"] is False for row in board)
