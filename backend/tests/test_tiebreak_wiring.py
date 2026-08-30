"""Wiring the tiebreaker through `get_leaderboard` (#540, stage 2).

`domain.tiebreak` (stage 1) is a pure module nothing calls yet. This is the
one place it gets called: `services.scoring.get_leaderboard` reorders a
same-score cluster per `Race.tiebreaker`, stamps each row with how it was
resolved, and — because `get_advancing_racers` and the awards service both
read standings straight off `get_leaderboard`'s order — a championship cut and
an award place inherit the resolved order with no code of their own.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.services import awards as awards_service
from backend.services import scoring
from backend.tests.helpers import as_lanes


def _seed(
    db: Session,
    tiebreaker: str = models.TiebreakMethod.SHARED,
    scoring_strategy: str = models.ScoringStrategy.TIMED,
) -> models.Race:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Tie Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Tie Track", lane_count=2, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Tie Race",
            organization_id=org.id,
            track_id=track.id,
            tiebreaker=tiebreaker,
            scoring_strategy=scoring_strategy,
        ),
    )


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


def _heat(db, race, round_obj, lanes, heat_number):
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=heat_number)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lanes))
    db.commit()
    return heat


def _lane(lane, racer_id, time=None):
    return {"lane": lane, "racer_id": racer_id, "time": time, "place": None}


def _tied_pair(db: Session, tiebreaker: str) -> tuple[models.Race, int, int]:
    """Two racers tied 3.0 average under TIMED, B created before A.

    B holds the lower (registration-order) racer id, which is exactly who
    every cut picked before #540. A's heats are the same average but a faster
    single time, so `BEST_TIME` (and only `BEST_TIME`, of the methods this
    module exercises) prefers A instead.
    """
    race = _seed(db, tiebreaker)
    round_obj = _round(db, race)
    slow_first = _racer(db, race, "B")  # lower id
    fast_second = _racer(db, race, "A")  # higher id, faster best time

    _heat(
        db,
        race,
        round_obj,
        [_lane(1, fast_second.id, time=2.0), _lane(2, slow_first.id, time=3.0)],
        heat_number=1,
    )
    _heat(
        db,
        race,
        round_obj,
        [_lane(1, fast_second.id, time=4.0), _lane(2, slow_first.id, time=3.0)],
        heat_number=2,
    )
    return race, fast_second.id, slow_first.id


def test_resolved_by_reaches_graphql_as_the_plain_method_name(client, db: Session):
    """`resolvedBy` crosses the GraphQL boundary as `"BEST_TIME"`, not a
    Python enum repr — `Race.tiebreaker` is a `str` subclass enum, and this is
    the same crossing every other enum-ish field here already makes.
    """
    race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)

    query = f"""
    query {{
      race(raceId: {race.id}) {{
        leaderboard {{ racerId rank resolvedBy }}
      }}
    }}
    """
    response = client.post("/graphql", json={"query": query})
    assert response.status_code == 200
    body = response.json()
    assert "errors" not in body
    rows = {row["racerId"]: row for row in body["data"]["race"]["leaderboard"]}

    assert rows[fast_id]["rank"] == 1
    assert rows[fast_id]["resolvedBy"] == "BEST_TIME"
    assert rows[slow_id]["resolvedBy"] == "BEST_TIME"


class TestGetLeaderboardResolvesTies:
    def test_best_time_reorders_and_names_itself(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}

        assert [row["racer_id"] for row in board] == [fast_id, slow_id]
        assert by_id[fast_id]["rank"] == 1
        assert by_id[slow_id]["rank"] == 2
        assert by_id[fast_id]["resolved_by"] == models.TiebreakMethod.BEST_TIME
        assert by_id[slow_id]["resolved_by"] == models.TiebreakMethod.BEST_TIME

    def test_total_time_resolves_the_same_pair_the_other_way(self, db: Session):
        # A's heats sum to 6.0 (2.0 + 4.0), B's to 6.0 (3.0 + 3.0) — equal, so
        # TOTAL_TIME is itself inconclusive here and the pair stays tied. This
        # pins that TOTAL_TIME and BEST_TIME really are different metrics, not
        # two names for the same computation.
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}

        assert by_id[fast_id]["rank"] == by_id[slow_id]["rank"] == 1
        assert by_id[fast_id]["resolved_by"] is None
        assert by_id[slow_id]["resolved_by"] is None
        # Inconclusive falls back to the registration-order pick, same as SHARED.
        assert [row["racer_id"] for row in board] == [slow_id, fast_id]


class TestSharedIsANoOp:
    def test_shared_reproduces_todays_order_exactly(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.SHARED)

        board = scoring.get_leaderboard(db, race.id)

        assert [row["racer_id"] for row in board] == [slow_id, fast_id]
        assert [row["rank"] for row in board] == [1, 1]
        assert all(row["resolved_by"] is None for row in board)


class TestInconclusiveChain:
    def test_head_to_head_between_racers_who_never_met_stays_tied(self, db: Session):
        """Two racers with the same POINTS score who never shared a heat.

        `HEAD_TO_HEAD` needs the tied cars to have raced each other; these two
        never did, so it answers nothing and the tie is left exactly as
        `SHARED` would leave it — same shared rank, same registration-order
        provisional pick, stable across repeated reads.
        """
        race = _seed(
            db,
            models.TiebreakMethod.HEAD_TO_HEAD,
            scoring_strategy=models.ScoringStrategy.POINTS,
        )
        round_obj = _round(db, race)
        low = _racer(db, race, "Low")
        high = _racer(db, race, "High")
        third = _racer(db, race, "Third")
        fourth = _racer(db, race, "Fourth")

        # Two separate heats, each a different pairing, so `low` and `high`
        # never race in the same heat.
        heat1 = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=1)
        db.add(heat1)
        db.flush()
        crud.set_heat_lanes(
            heat1,
            as_lanes(
                [
                    {"lane": 1, "racer_id": low.id, "time": None, "place": 1},
                    {"lane": 2, "racer_id": third.id, "time": None, "place": 2},
                ]
            ),
        )
        heat2 = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=2)
        db.add(heat2)
        db.flush()
        crud.set_heat_lanes(
            heat2,
            as_lanes(
                [
                    {"lane": 1, "racer_id": high.id, "time": None, "place": 1},
                    {"lane": 2, "racer_id": fourth.id, "time": None, "place": 2},
                ]
            ),
        )
        db.commit()

        board_1 = scoring.get_leaderboard(db, race.id)
        board_2 = scoring.get_leaderboard(db, race.id)

        by_id_1 = {row["racer_id"]: row for row in board_1}
        assert by_id_1[low.id]["rank"] == by_id_1[high.id]["rank"] == 1
        assert by_id_1[low.id]["resolved_by"] is None
        assert by_id_1[high.id]["resolved_by"] is None
        # `low` was created first, so it is the registration-order pick —
        # exactly today's silent behaviour, now just not silently promoted.
        assert [row["racer_id"] for row in board_1][:2] == [low.id, high.id]
        # Stable across repeated reads — nothing here is random or cached.
        order_1 = [row["racer_id"] for row in board_1]
        order_2 = [row["racer_id"] for row in board_2]
        assert order_1 == order_2


class TestAdvancementInheritsTheTiebreak:
    def test_a_tie_at_the_cut_follows_the_races_tiebreaker(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)

        winners = scoring.get_advancing_racers(db, race.id, "ALL", 1)

        assert winners == [fast_id]

    def test_an_inconclusive_tie_at_the_cut_keeps_the_provisional_pick(
        self, db: Session
    ):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)

        winners_1 = scoring.get_advancing_racers(db, race.id, "ALL", 1)
        winners_2 = scoring.get_advancing_racers(db, race.id, "ALL", 1)

        # TOTAL_TIME does not separate this pair (see above), so the slot
        # goes to whoever registered first — exactly as it always has — and
        # that pick is stable across repeated reads rather than flapping.
        assert winners_1 == [slow_id]
        assert winners_2 == [slow_id]


class TestAwardsInheritTheTiebreak:
    def test_a_speed_award_place_follows_the_races_tiebreaker(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Overall",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )

        recipients = awards_service.recipients_for(db, race.id)

        assert recipients[award.id] == fast_id

    def test_an_unresolved_award_place_keeps_the_provisional_pick(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.SHARED)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Overall",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )

        recipients = awards_service.recipients_for(db, race.id)

        assert recipients[award.id] == slow_id


class TestContestedCut:
    """The seeing half for a cut a tiebreaker did not settle (#540) — see
    `test_domain_advancement.py` for the rule itself. This is the wiring:
    `scoring.pick_advancing_racers` and `AdvancementStatus.contestedCut`.
    """

    def test_an_inconclusive_tie_at_the_cut_is_contested(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)

        pick = scoring.pick_advancing_racers(db, race.id, "ALL", 1)

        assert pick.winner_ids == [slow_id]
        assert pick.contested is True

    def test_a_resolved_tie_at_the_cut_is_not_contested(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)

        pick = scoring.pick_advancing_racers(db, race.id, "ALL", 1)

        assert pick.winner_ids == [fast_id]
        assert pick.contested is False

    def test_a_cut_that_clears_the_whole_field_is_not_contested(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)

        pick = scoring.pick_advancing_racers(db, race.id, "ALL", 2)

        assert set(pick.winner_ids) == {fast_id, slow_id}
        assert pick.contested is False

    def test_contested_cut_reaches_graphql_on_the_advancement_status(
        self, client, db: Session
    ):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)
        final = crud.create_round(
            db,
            race.id,
            round_number=2,
            scheduling_strategy=models.SchedulingStrategy.PPC,
            name="Final",
            advancement_source="ALL",
            advancement_num_racers=1,
        )

        query = f"""
        query {{
          race(raceId: {race.id}) {{
            rounds {{
              id
              advancementStatus {{ contestedCut }}
            }}
          }}
        }}
        """
        response = client.post("/graphql", json={"query": query})
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body
        rounds = {r["id"]: r for r in body["data"]["race"]["rounds"]}
        assert rounds[final.id]["advancementStatus"]["contestedCut"] is True


class TestPlaceContested:
    """The awards-screen half of the same flag: `Award.placeContested`."""

    def test_an_inconclusive_tie_for_the_place_is_contested(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Overall",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )

        assert awards_service.contested_for(db, race.id)[award.id] is True

    def test_a_resolved_place_is_not_contested(self, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.BEST_TIME)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Overall",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )

        assert awards_service.contested_for(db, race.id)[award.id] is False

    def test_a_special_award_is_never_contested(self, db: Session):
        race, _fast_id, _slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(name="Best Paint", kind=models.AwardKind.SPECIAL),
        )

        assert awards_service.contested_for(db, race.id)[award.id] is False

    def test_place_contested_reaches_graphql(self, client, db: Session):
        race, fast_id, slow_id = _tied_pair(db, models.TiebreakMethod.TOTAL_TIME)
        award = crud.create_award(
            db,
            race.id,
            schemas.AwardCreate(
                name="Fastest Overall",
                kind=models.AwardKind.SPEED,
                source="ALL",
                place=1,
            ),
        )

        query = f"""
        query {{
          race(raceId: {race.id}) {{
            awards {{ id placeContested }}
          }}
        }}
        """
        response = client.post("/graphql", json={"query": query})
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body
        rows = {row["id"]: row for row in body["data"]["race"]["awards"]}
        assert rows[award.id]["placeContested"] is True
