"""A round built with more than one run per lane stays that size (#230).

#143 made the wizard honor ``runsPerLane`` and taught ``regenerateRound`` to
derive the run count from the heats — and no test exercised a run count above
one, so nothing noticed that the two *rebuild* paths never learned it:
``invalidate_future_rounds`` fires on every recorded prelim result, and
``populate_round_field`` rebuilds a short field. Each regenerated a single
run, so a two-run final quietly became a one-run final the moment the racing
started.

The derivation now lives in ``generate_heats_for_round`` itself, and these are
the first tests in the tree with ``runs > 1``.
"""

import pytest

from backend.db import crud, models, schemas
from backend.domain import audit, lanes


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Multi-Run Pack"))
    track = crud.create_track(
        db,
        schemas.TrackCreate(name="Multi-Run Track", lane_count=2, timer_type="FAKE"),
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name="Multi-Run Derby", group_id=group.id, track_id=track.id
        ),
    )
    for i in range(4):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="Runs",
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return race


def _heats_of(db, round_id):
    return sorted(
        db.query(models.Heat).filter(models.Heat.round_id == round_id).all(),
        key=lambda h: h.heat_number,
    )


def _race_heat(db, heat):
    raced = [
        lanes.Lane(
            lane=ln.lane,
            racer_id=ln.racer_id,
            time=3.0 + ln.lane / 10,
            place=ln.lane,
        )
        for ln in crud.heat_lanes_of(db, heat)
        if ln.racer_id is not None
    ]
    crud.record_heat_result(db, heat.id, raced, source=audit.ResultSource.OPERATOR)


def _two_run_final(db, race, num_racers=2):
    prelim = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, prelim.id)
    final = crud.create_round(
        db,
        race_id=race.id,
        round_number=2,
        advancement_source="PACK",
        advancement_num_racers=num_racers,
    )
    crud.generate_heats_for_round(
        db, final.id, num_placeholders=num_racers, clear_existing=True, runs=2
    )
    return prelim, final


def test_runs_builds_that_many_schedules(db, race):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    heats = crud.generate_heats_for_round(db, round_obj.id, runs=2)

    # PPC makes one heat per racer per run, numbered continuously.
    assert len(heats) == 8
    assert [h.heat_number for h in _heats_of(db, round_obj.id)] == list(range(1, 9))


def test_each_racer_appears_once_per_lane_per_run(db, race):
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id, runs=2)

    appearances: dict[tuple[int, int], int] = {}
    for heat_lanes in crud._round_heat_lanes(db, round_obj.id):
        for lane in heat_lanes:
            if lane.racer_id is not None:
                key = (lane.racer_id, lane.lane)
                appearances[key] = appearances.get(key, 0) + 1

    # Two runs: every racer runs every lane exactly twice.
    assert set(appearances.values()) == {2}


def test_a_two_run_final_survives_a_prelim_result(db, race):
    """The bug itself: invalidation fires on every result, and its rebuild
    collapsed the final to one run."""
    prelim, final = _two_run_final(db, race)
    assert len(_heats_of(db, final.id)) == 4  # 2 slots x 2 runs

    _race_heat(db, _heats_of(db, prelim.id)[0])

    assert len(_heats_of(db, final.id)) == 4


def test_the_reset_rewrites_rows_so_ids_survive(db, race):
    """#50's guarantee, extended to multi-run rounds: invalidation must not
    swap the heats for new rows with new ids."""
    prelim, final = _two_run_final(db, race)
    ids_before = [h.id for h in _heats_of(db, final.id)]

    _race_heat(db, _heats_of(db, prelim.id)[0])

    assert [h.id for h in _heats_of(db, final.id)] == ids_before


def test_a_short_field_rebuild_keeps_both_runs(db, race):
    """`populate_round_field` rebuilds when fewer racers qualified than the
    round holds slots; that rebuild used to collapse the runs too."""
    prelim, final = _two_run_final(db, race, num_racers=3)
    assert len(_heats_of(db, final.id)) == 6  # 3 slots x 2 runs

    # Only two racers qualify: the field is short, so the round is rebuilt.
    crud.populate_round_field(db, final.id, [1, 2])

    heats = _heats_of(db, final.id)
    assert len(heats) == 4  # 2 racers x 2 runs, not 2 x 1


def test_a_further_invalidation_after_a_short_field_rebuild_keeps_both_runs(db, race):
    """#311: the short-field rebuild collapses a round to its *actual* field,
    and a later invalidation used to derive `runs` from the round's
    *requested* field again — which no longer matches the heats it was
    rebuilding, so a two-run final lost a run all over again.

    Reproduces the issue's own trace: a 4-slot, 2-run final that only 3
    racers ever qualify for, short-field-rebuilt once already, then hit by
    the ordinary invalidation a prelim correction fires on every later
    championship round.
    """
    prelim, final = _two_run_final(db, race, num_racers=4)
    assert len(_heats_of(db, final.id)) == 8  # 4 slots x 2 runs

    # Only three of the four racers qualify: the field comes up short, so
    # the round is rebuilt for the field it can actually fill.
    crud.populate_round_field(db, final.id, [1, 2, 3])
    assert len(_heats_of(db, final.id)) == 6  # 3 racers x 2 runs

    # A prelim result changes. Invalidation resets the final back to
    # placeholders sized for the *request* (four) — which does not divide
    # evenly into the six heats the round actually holds (#230's check), so
    # it falls all the way to full regeneration.
    crud.invalidate_future_rounds(db, race.id, prelim.round_number)
    assert len(_heats_of(db, final.id)) == 8  # 4 placeholder slots x 2 runs

    # Re-population finds the same three qualifiers again.
    crud.populate_round_field(db, final.id, [1, 2, 3])
    heats = _heats_of(db, final.id)
    assert len(heats) == 6  # 3 racers x 2 runs, not 3 x 1


def test_regenerate_preserves_the_run_count(db, race):
    """#143's original case, now riding the shared derivation."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id, runs=2)

    regenerated = crud.generate_heats_for_round(db, round_obj.id, clear_existing=True)

    assert len(regenerated) == 8


def test_a_single_run_round_stays_single(db, race):
    """The derivation must not invent heats for the common case."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=1)
    crud.generate_heats_for_round(db, round_obj.id)

    regenerated = crud.generate_heats_for_round(db, round_obj.id, clear_existing=True)

    assert len(regenerated) == 4
