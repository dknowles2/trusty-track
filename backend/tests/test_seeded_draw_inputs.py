"""A seeded draw is only as repeatable as the order of what it draws from.

The documentation screenshots run with ``TRUSTYTRACK_DEMO_SEED`` set, and the
seeding was measured to work — until a batch run produced a different free-race
field and a different schedule than the run before it, with the same seed and
the same key. The variable was the *input*: the queries feeding the shuffles
carried no ``ORDER BY``, and a query without one promises no order at all.
SQLite usually returns rowid order, which is why this held for a long time and
then did not.

These tests recompute each draw from a hand-ordered copy of its input and
require the production answer to match. If a query loses its ``order_by`` —
or the championship branch goes back to iterating a set — the recomputation
disagrees the moment row order drifts, and meanwhile the *shape* of the pin
(exact equality against an independently-built expectation) documents where
the answer is supposed to come from.
"""

import random

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from backend import demo_seed
from backend.db import crud, models, schemas
from backend.domain import scheduling
from backend.services import scoring

SEED = "a-fixed-seed"


@pytest.fixture
def seeded(monkeypatch):
    monkeypatch.setenv(demo_seed.SEED_VARIABLE, SEED)


def _race(db, name="Ordered Draws Derby") -> models.Race:
    group = crud.create_group(db, schemas.GroupCreate(name=f"Pack for {name}"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"Track for {name}", lane_count=4, timer_type="FAKE"),
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            group_id=group.id,
            name=name,
            date_time="2024-01-01T10:00:00",
            track_id=track.id,
            scheduling_strategy=models.SchedulingStrategy.PPC,
            scoring_strategy=models.ScoringStrategy.TIMED,
        ),
    )


def _racers(db, race_id, count) -> list[int]:
    ids = []
    for n in range(count):
        racer = crud.create_racer(
            db,
            schemas.RacerCreate(
                race_id=race_id,
                first_name=f"Racer{n}",
                last_name="Test",
                car_number=n + 1,
                car_passed_inspection=True,
            ),
        )
        ids.append(racer.id)
    return ids


@pytest.mark.usefixtures("seeded")
class TestFreeRaceLanes:
    def test_the_pick_is_the_seeded_shuffle_of_the_ids_in_order(self, db):
        race = _race(db)
        ids = _racers(db, race.id, 6)

        picks = crud.get_random_lane_assignments(db, race.id, 4)

        expected = sorted(ids)
        random.Random(f"{SEED}:free-race lanes:{race.name}:0").shuffle(expected)
        assert [p["racer_id"] for p in picks] == expected[:4]

    def test_two_calls_agree(self, db):
        """The operator's preview and the heat they then start must match."""
        race = _race(db, name="Preview Agreement Derby")
        _racers(db, race.id, 6)

        assert crud.get_random_lane_assignments(
            db, race.id, 4
        ) == crud.get_random_lane_assignments(db, race.id, 4)

    def test_a_re_shuffle_draws_again(self, db):
        """Re-shuffle has to change something, seed or no seed.

        Every draw of a race used to share one key, so under a seed they all
        came out identical — which is the public demo, where the button could
        not do anything at all. Counting the draws keys them apart.
        """
        race = _race(db, name="Re-shuffle Derby")
        _racers(db, race.id, 8)

        draws = [
            tuple(
                p["racer_id"]
                for p in crud.get_random_lane_assignments(db, race.id, 4, shuffle=n)
            )
            for n in range(4)
        ]

        assert len(set(draws)) == len(draws)

    def test_a_given_draw_is_still_repeatable(self, db):
        """The counter keys the draw; it does not make it random again.

        A screen that reloads asks for draw 0 and must get the same lanes back,
        which is what the seed is for.
        """
        race = _race(db, name="Repeatable Re-shuffle Derby")
        _racers(db, race.id, 8)

        assert crud.get_random_lane_assignments(
            db, race.id, 4, shuffle=3
        ) == crud.get_random_lane_assignments(db, race.id, 4, shuffle=3)


@pytest.mark.usefixtures("seeded")
class TestScheduleGeneration:
    def test_a_general_round_schedules_the_ids_in_order(self, db):
        race = _race(db, name="Ordered Schedule Derby")
        ids = _racers(db, race.id, 6)
        round_obj = crud.create_round(db, race_id=race.id, round_number=1)

        heats = crud.generate_heats_for_round(db, round_obj.id)

        expected_plans = scheduling.generate_ppc(
            sorted(ids),
            [1, 2, 3, 4],
            rng=demo_seed.rng(f"schedule:{race.name}:1"),
        )
        got = [
            {lane.lane: lane.racer_id for lane in crud.heat_lanes_of(db, heat)}
            for heat in heats
        ]
        want = [dict(plan.assignments) for plan in expected_plans]
        assert got == want

    def test_a_championship_rebuild_schedules_its_field_in_id_order(self, db):
        """The field of a raced-into championship round arrives as a set, and
        set iteration order is not a promise anything keeps."""
        race = _race(db, name="Ordered Final Derby")
        ids = _racers(db, race.id, 4)
        final = crud.create_round(
            db,
            race_id=race.id,
            round_number=2,
            advancement_source="PACK",
            advancement_num_racers=4,
        )
        existing = crud.generate_heats_for_round(db, final.id, num_placeholders=4)
        crud.resolve_round_placeholders(db, final.id, sorted(ids, reverse=True))

        # `clear_existing=False` is the path that reads the field back out of
        # the heats — with `True` they are deleted before being read, and the
        # round re-fields as placeholders instead.
        heats = crud.generate_heats_for_round(db, final.id, clear_existing=False)

        expected_plans = scheduling.generate_ppc(
            sorted(ids),
            [1, 2, 3, 4],
            start_heat_number=len(existing) + 1,
            rng=demo_seed.rng(f"schedule:{race.name}:2"),
        )
        got = [
            {lane.lane: lane.racer_id for lane in crud.heat_lanes_of(db, heat)}
            for heat in heats
        ]
        want = [dict(plan.assignments) for plan in expected_plans]
        assert got == want


class TestDenAdvancementOrder:
    """#316: den order isn't a shuffle, but it feeds the same kind of
    unpromised query this file is about. ``get_advancing_racers`` visits dens
    in the order ``db.query(models.Den)`` hands them back, and that order
    decides which placeholder slot (and so which lane pattern) each den's
    qualifiers land in — #240's rule applies here even though nothing is
    seeded: a query fixing an output order needs an ``ORDER BY``, or the
    promise is one SQLite is not making.
    """

    def test_the_den_query_carries_an_order_by(self, db):
        race = _race(db, name="Ordered Den Advancement Derby")
        for i in range(3):
            crud.create_den(db, schemas.DenCreate(name=f"Den{i}"), race.id)
        db.commit()

        statements: list[str] = []

        def _capture(_conn, _cursor, statement, *_args):
            if "FROM dens" in statement:
                statements.append(statement)

        event.listen(Engine, "before_cursor_execute", _capture)
        try:
            scoring.get_advancing_racers(db, race.id, source="DEN", num_top=1)
        finally:
            event.remove(Engine, "before_cursor_execute", _capture)

        # `get_leaderboard` (via `_standings_for`) also queries `dens` to build
        # a lookup dict, unordered on purpose — dict-by-id doesn't care. It is
        # among these statements too, so this only requires *one* of them to
        # carry the promise: the query that builds `den_ids`.
        assert statements, "expected get_advancing_racers to query dens"
        assert any("ORDER BY dens.id" in s for s in statements), statements
