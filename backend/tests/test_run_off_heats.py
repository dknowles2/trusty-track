"""A run-off heat settles a tie without joining the score that produced it
(#550).

Complements `test_domain_tiebreak.py` (the pure `RUN_OFF` resolution, no
database) with the wiring: `crud.create_run_off_heat`, its exclusion from
`services.scoring` and `services.records`, `services.scoring.
run_off_contested_rank`'s "computed, never stored" rule, and the GraphQL
mutations end to end.
"""

import pytest
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit
from backend.domain import scoring as domain_scoring
from backend.services import records as records_service
from backend.services import scoring
from backend.tests.helpers import as_lanes, record_heat_result


def _seed(
    db: Session, tiebreaker: str = models.TiebreakMethod.SHARED
) -> tuple[models.Race, models.Track]:
    org = crud.create_organization(db, schemas.OrganizationCreate(name="Run-off Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Run-off Track", lane_count=4, timer_type="FAKE")
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Run-off Race",
            organization_id=org.id,
            track_id=track.id,
            tiebreaker=tiebreaker,
        ),
    )
    return race, track


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


def _heat(db, race, round_obj, lane_rows, heat_number):
    heat = models.Heat(race_id=race.id, round_id=round_obj.id, heat_number=heat_number)
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lane_rows))
    db.commit()
    return heat


def _lane(lane, racer_id, time=None):
    return {"lane": lane, "racer_id": racer_id, "time": time, "place": None}


def _record(db, heat_id, lane_rows):
    return crud.record_heat_result(
        db, heat_id, as_lanes(lane_rows), source=audit.ResultSource.OPERATOR
    )


def _tied_pair(
    db: Session, tiebreaker: str = models.TiebreakMethod.SHARED
) -> tuple[models.Race, models.Round, models.Racer, models.Racer]:
    """Two racers, each averaging 3.0s across two official heats — tied."""
    race, _track = _seed(db, tiebreaker)
    round_obj = _round(db, race)
    a = _racer(db, race, "Alfa")
    b = _racer(db, race, "Bravo")
    _heat(db, race, round_obj, [_lane(1, a.id, 3.0), _lane(2, b.id, 3.0)], 1)
    _heat(db, race, round_obj, [_lane(1, a.id, 3.0), _lane(2, b.id, 3.0)], 2)
    return race, round_obj, a, b


def _tied_pair_best_time_biased(
    db: Session, tiebreaker: str
) -> tuple[models.Race, models.Round, models.Racer, models.Racer]:
    """Same 3.0s average for both, but Alfa's best single heat (2.0) beats
    Bravo's (3.0) — so `BEST_TIME` alone would rank Alfa first."""
    race, _track = _seed(db, tiebreaker)
    round_obj = _round(db, race)
    a = _racer(db, race, "Alfa")
    b = _racer(db, race, "Bravo")
    _heat(db, race, round_obj, [_lane(1, a.id, 2.0), _lane(2, b.id, 3.0)], 1)
    _heat(db, race, round_obj, [_lane(1, a.id, 4.0), _lane(2, b.id, 3.0)], 2)
    return race, round_obj, a, b


class TestScoringExclusion:
    """Rule 1: a run-off never feeds an aggregate score."""

    def test_a_run_off_heats_time_never_reaches_the_leaderboard_score(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 0.5), _lane(2, b.id, 0.6)])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["score"] == 3.0
        assert by_id[b.id]["score"] == 3.0
        assert by_id[a.id]["heats_completed"] == 2
        assert by_id[b.id]["heats_completed"] == 2

    def test_excluded_under_scope_all_too(self, db):
        """The exclusion is unconditional in `_scoring_heats`, not only on
        the ordinary `PRELIM` path — see its own comment on why."""
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 0.5), _lane(2, b.id, 0.6)])

        board = scoring.get_leaderboard(db, race.id, scope=domain_scoring.ALL)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["score"] == 3.0
        assert by_id[a.id]["heats_completed"] == 2

    def test_excluded_from_a_round_scoped_leaderboard(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 0.5), _lane(2, b.id, 0.6)])

        board = scoring.get_leaderboard(db, race.id, round_id=round_obj.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["heats_completed"] == 2


class TestRecordsExclusion:
    """Rule 2: what a run-off decides is scoped to its cut — never a track
    record's population, even though it is a real run on the track."""

    def test_a_run_off_heats_time_never_sets_a_track_record(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        # Blazing fast — would crush both racers' real 3.0s best if it counted.
        _record(db, run_off.id, [_lane(1, a.id, 0.1), _lane(2, b.id, 0.2)])

        entries = records_service.track_records(db, race.track_id)
        best = {entry.racer_name: entry.time_seconds for entry in entries}
        assert best["Alfa T"] == 3.0
        assert best["Bravo T"] == 3.0


class TestResolutionPrecedence:
    """Rule 3: resolves through the same door as everything else, and beats
    the race's own configured tiebreaker when it exists."""

    def test_a_decided_run_off_resolves_the_tie_and_names_itself(self, db):
        race, round_obj, a, b = _tied_pair(db, models.TiebreakMethod.SHARED)
        # `settles_round_id=None`: matches the "Current Standings" (overall,
        # prelim-scoped) view this test reads through below — the same
        # scope key `get_leaderboard`'s own `round_id=None` default carries.
        # A race with a single prelim round makes the two *numerically*
        # equal, but the run-off only resolves the view it was created
        # against; see `test_settles_round_id_may_be_null_for_the_overall_
        # standings` and the class docstring on `Heat.settles_round_id`.
        run_off = crud.create_run_off_heat(db, race.id, None, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["rank"] == 1
        assert by_id[b.id]["rank"] == 2
        assert by_id[a.id]["resolved_by"] == "RUN_OFF"
        assert by_id[b.id]["resolved_by"] == "RUN_OFF"

    def test_a_run_off_beats_the_races_configured_tiebreaker(self, db):
        """`BEST_TIME` alone would rank Alfa first (see the fixture); a
        decided run-off that goes the other way still wins."""
        race, round_obj, a, b = _tied_pair_best_time_biased(
            db, models.TiebreakMethod.BEST_TIME
        )
        run_off = crud.create_run_off_heat(db, race.id, None, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 5.0), _lane(2, b.id, 1.0)])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[b.id]["rank"] == 1
        assert by_id[a.id]["rank"] == 2
        assert by_id[b.id]["resolved_by"] == "RUN_OFF"

    def test_an_unrecorded_run_off_leaves_the_tie_shared(self, db):
        race, round_obj, a, b = _tied_pair(db, models.TiebreakMethod.SHARED)
        crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["rank"] == 1
        assert by_id[b.id]["rank"] == 1
        assert by_id[a.id]["resolved_by"] is None


class TestComputedNotStored:
    """Rule 4: the heat is stored, its consequence derived on every read."""

    def test_placement_matches_the_current_shared_rank_before_it_is_run(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        assert scoring.run_off_contested_rank(db, race.id, run_off) == 1

    def test_placement_is_gone_once_the_run_off_resolves_the_tie(self, db):
        """Resolving the tie is itself a reason `placement` returns to
        `None`: Alfa and Bravo no longer share a rank once the run-off has
        separated them, so there is no longer a cluster to report a shared
        rank for — the announcement's job was to say what is being decided
        while the race is still open, and it is not open any more."""
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])

        assert scoring.run_off_contested_rank(db, race.id, run_off) is None

    def test_correcting_the_source_time_can_dissolve_the_tie_the_run_off_settled(
        self, db
    ):
        """The run-off decided a tie between two *racers*, not a rank
        number. A time corrected elsewhere in the round it settles can move
        who is tied, or erase the tie outright — and when that happens the
        run-off resolves nothing, exactly as if it had never been run."""
        race, round_obj, a, b = _tied_pair(db, models.TiebreakMethod.SHARED)
        run_off = crud.create_run_off_heat(db, race.id, None, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["resolved_by"] == "RUN_OFF"

        # Correct the round's own first heat: Alfa pulls decisively ahead on
        # the aggregate, and the tie the run-off was created for is gone.
        heat_one = (
            db.query(models.Heat)
            .filter(models.Heat.round_id == round_obj.id, models.Heat.heat_number == 1)
            .first()
        )
        _record(db, heat_one.id, [_lane(1, a.id, 1.0), _lane(2, b.id, 3.0)])

        board = scoring.get_leaderboard(db, race.id)
        by_id = {row["racer_id"]: row for row in board}
        assert by_id[a.id]["rank"] == 1
        assert by_id[b.id]["rank"] == 2
        # Never tied to begin with, from this reading's point of view — so
        # nothing resolved either of them, run-off or otherwise.
        assert by_id[a.id]["resolved_by"] is None
        assert by_id[b.id]["resolved_by"] is None
        assert scoring.run_off_contested_rank(db, race.id, run_off) is None


class TestCreateValidation:
    def test_fewer_than_two_racers_is_refused(self, db):
        race, round_obj, a, _b = _tied_pair(db)
        with pytest.raises(ValueError):
            crud.create_run_off_heat(db, race.id, round_obj.id, [a.id])

    def test_more_racers_than_usable_lanes_is_refused(self, db):
        race, track = _seed(db)  # 4 lanes
        round_obj = _round(db, race)
        racers = [_racer(db, race, f"R{i}") for i in range(5)]
        with pytest.raises(ValueError):
            crud.create_run_off_heat(db, race.id, round_obj.id, [r.id for r in racers])

    def test_settles_round_id_may_be_null_for_the_overall_standings(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, None, [a.id, b.id])
        assert run_off.settles_round_id is None
        assert scoring.run_off_contested_rank(db, race.id, run_off) == 1


class TestDeletion:
    def test_an_unrun_run_off_can_be_deleted(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        assert crud.delete_run_off_heat(db, run_off.id) is True
        assert crud.get_run_off_heat(db, run_off.id) is None

    def test_a_recorded_run_off_cannot_be_deleted(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])
        with pytest.raises(ValueError):
            crud.delete_run_off_heat(db, run_off.id)


class TestRunningOrder:
    """`onDeck`/`currentlyRacing` are the deliberate exception to
    `official_heats` that includes a run-off (#550)."""

    def test_a_run_off_appears_in_the_running_order_after_its_round(self, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])

        ordered = crud.heats_in_running_order(db, race.id)
        assert ordered[-1].id == run_off.id
        assert ordered[-1].kind == models.HeatKind.RUN_OFF

    def test_a_recorded_run_off_drops_out_once_finished(self, db):
        """`_unfinished` filters on `lanes.is_finished`, which a run-off
        heat participates in exactly like any other heat."""
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])
        _record(db, run_off.id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])

        from backend.domain import lanes as domain_lanes

        ordered = crud.heats_in_running_order(db, race.id)
        run_off_row = next(h for h in ordered if h.id == run_off.id)
        assert domain_lanes.is_finished(crud.heat_lanes_of(db, run_off_row))


def _create_track_via_graphql(client, name: str = "GraphQL Run-off Track") -> int:
    """A track created through the `createTrack` mutation, not `crud`
    directly — the only route that registers a `TimerManager` for it, which
    `prepareHeat` needs to find (`_heat_and_manager`)."""
    query = "mutation($track: TrackInput!) { createTrack(track: $track) { id } }"
    response = client.post(
        "/graphql",
        json={"query": query, "variables": {"track": {"name": name}}},
    )
    body = response.json()
    assert "errors" not in body, body
    return body["data"]["createTrack"]["id"]


class TestGraphQLMutations:
    """End to end: the mutation, arming and recording through the ordinary
    door, and the standings and schedule fields the operator actually
    reads."""

    def test_create_and_record_a_run_off_through_graphql(self, client, db):
        org = crud.create_organization(
            db, schemas.OrganizationCreate(name="GraphQL Run-off Pack")
        )
        track_id = _create_track_via_graphql(client)
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="GraphQL Run-off Race", organization_id=org.id, track_id=track_id
            ),
        )
        round_obj = _round(db, race)
        a = _racer(db, race, "Alfa")
        b = _racer(db, race, "Bravo")
        _heat(db, race, round_obj, [_lane(1, a.id, 3.0), _lane(2, b.id, 3.0)], 1)
        _heat(db, race, round_obj, [_lane(1, a.id, 3.0), _lane(2, b.id, 3.0)], 2)

        create_query = """
        mutation($raceId: Int!, $racerIds: [Int!]!, $settlesRoundId: Int) {
          createRunOffHeat(
            raceId: $raceId, racerIds: $racerIds, settlesRoundId: $settlesRoundId
          ) {
            id
            settlesRoundId
            recorded
            placement
            lanes { lane racerId }
          }
        }
        """
        response = client.post(
            "/graphql",
            json={
                "query": create_query,
                "variables": {
                    "raceId": race.id,
                    "racerIds": [a.id, b.id],
                    # Null: settles the race's overall standings — the same
                    # scope `race.leaderboard` below reads with no `roundId`
                    # argument, which is the "Current Standings" default a
                    # single-round race like this one shows.
                    "settlesRoundId": None,
                },
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body, body
        created = body["data"]["createRunOffHeat"]
        assert created["settlesRoundId"] is None
        assert created["recorded"] is False
        assert created["placement"] == 1
        lane_racers = {lane["lane"]: lane["racerId"] for lane in created["lanes"]}
        assert set(lane_racers.values()) == {a.id, b.id}
        heat_id = created["id"]

        # Armed and recorded through the ordinary timer path — no special
        # casing for `RUN_OFF` in either mutation.
        prepare = client.post(
            "/graphql",
            json={
                "query": "mutation($heatId: Int!) { prepareHeat(heatId: $heatId) }",
                "variables": {"heatId": heat_id},
            },
        )
        assert prepare.json()["data"]["prepareHeat"] is True

        record_heat_result(client, heat_id, [_lane(1, a.id, 2.0), _lane(2, b.id, 2.5)])

        query = f"""
        query {{
          race(raceId: {race.id}) {{
            leaderboard {{ racerId rank resolvedBy }}
            runOffHeats {{ id recorded placement }}
          }}
        }}
        """
        response = client.post("/graphql", json={"query": query})
        body = response.json()
        assert "errors" not in body, body
        data = body["data"]["race"]

        rows = {row["racerId"]: row for row in data["leaderboard"]}
        assert rows[a.id]["rank"] == 1
        assert rows[b.id]["rank"] == 2
        assert rows[a.id]["resolvedBy"] == "RUN_OFF"

        assert len(data["runOffHeats"]) == 1
        run_off = data["runOffHeats"][0]
        assert run_off["id"] == heat_id
        assert run_off["recorded"] is True
        # Settled — see TestComputedNotStored's explanation of why this is
        # null once the tie it names no longer exists.
        assert run_off["placement"] is None

    def test_fewer_than_two_racers_is_a_graphql_error(self, client, db):
        race, round_obj, a, _b = _tied_pair(db)
        query = """
        mutation($raceId: Int!, $racerIds: [Int!]!, $settlesRoundId: Int) {
          createRunOffHeat(
            raceId: $raceId, racerIds: $racerIds, settlesRoundId: $settlesRoundId
          ) { id }
        }
        """
        response = client.post(
            "/graphql",
            json={
                "query": query,
                "variables": {
                    "raceId": race.id,
                    "racerIds": [a.id],
                    "settlesRoundId": round_obj.id,
                },
            },
        )
        assert response.status_code == 200
        assert "errors" in response.json()

    def test_delete_run_off_heat_through_graphql(self, client, db):
        race, round_obj, a, b = _tied_pair(db)
        run_off = crud.create_run_off_heat(db, race.id, round_obj.id, [a.id, b.id])

        query = "mutation($heatId: Int!) { deleteRunOffHeat(heatId: $heatId) }"
        response = client.post(
            "/graphql",
            json={"query": query, "variables": {"heatId": run_off.id}},
        )
        assert response.status_code == 200
        body = response.json()
        assert "errors" not in body, body
        assert body["data"]["deleteRunOffHeat"] is True
        assert crud.get_run_off_heat(db, run_off.id) is None
