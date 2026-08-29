"""What a visitor lands on, and that seeding it twice is not two demos.

The opening state is the whole point of stage 2: standings drawn from real
results, a championship field that filled itself through the advancement
cascade, and a heat still on the schedule for the visitor to run. Each of those
is a separate test, because each is a separate way for the demo to open on
something dull.
"""

import pytest

from backend import demo_content, demo_seed
from backend.db import crud, models, schemas
from backend.domain import lanes
from backend.services import scoring


@pytest.fixture
def seeded(db):
    return demo_content.seed(db)


# --------------------------------------------------------------------------- #
# Idempotence                                                                  #
# --------------------------------------------------------------------------- #


def test_a_fresh_database_is_not_seeded(db):
    assert not demo_content.is_seeded(db)


def test_seeding_makes_it_seeded(db, seeded):  # noqa: ARG001 - seeds
    assert demo_content.is_seeded(db)


def test_any_configured_install_counts_as_seeded(db):
    """`is_seeded` asks the same question the first-run gate does — an install
    is configured exactly when a `Organization` exists — which is why there is no
    marker column. #201 declined one for the practice race for the same reason:
    a flag would be a schema change for something nothing else branches on.

    The consequence is deliberate. A demo container that somehow starts against
    a database holding somebody's real event must not seed a second one on top
    of it.
    """
    crud.create_organization(db, schemas.OrganizationCreate(name="Someone Else's Pack"))

    assert demo_content.is_seeded(db)


# --------------------------------------------------------------------------- #
# The opening state                                                            #
# --------------------------------------------------------------------------- #


def test_the_track_is_a_fake_timer(db, seeded):  # noqa: ARG001 - seeds
    """Arming a heat on a real timer sends a signal to a device in a room
    somebody may be standing in. The demo has no room."""
    tracks = crud.get_tracks(db)

    assert [t.timer_type for t in tracks] == [models.TimerType.FAKE]


def test_the_roster_is_checked_in(db, seeded):
    """`generate_heats_for_round` fields only racers that passed inspection, so
    an uninspected roster produces an empty schedule rather than an error."""
    racers = crud.get_racers(db, seeded.id)

    assert racers
    assert all(r.car_passed_inspection for r in racers)


def test_the_standings_are_not_empty(db, seeded):
    """The first of the three things worth seeing. A demo opening on a blank
    leaderboard shows the part an evaluator can already imagine."""
    standings = scoring.get_leaderboard(db, seeded.id)

    assert len(standings) > 1
    assert all(entry["heats_completed"] > 0 for entry in standings)
    assert [entry["rank"] for entry in standings] == sorted(
        entry["rank"] for entry in standings
    )


def test_the_final_filled_itself_from_the_cascade(db, seeded):
    """The second. Advancement is the part of race day that surprises people,
    and it is worth arriving already done rather than described."""
    final = _final_round(db, seeded)
    fielded = [
        lane
        for heat in crud.get_heats(db, seeded.id, round_id=final.id)
        for lane in crud.heat_lanes_of(db, heat)
    ]

    assert fielded, "the final has no heats"
    assert not any(lane.placeholder_slot for lane in fielded), (
        "the final still holds unadvanced slots — the cascade did not run"
    )
    assert any(lane.racer_id for lane in fielded)


def test_a_heat_is_left_to_run(db, seeded):
    """The third, and the one an all-raced demo loses: a visitor should be able
    to *do* something, not only read what already happened."""
    final = _final_round(db, seeded)
    unrun = [
        heat
        for heat in crud.get_heats(db, seeded.id, round_id=final.id)
        if not lanes.has_results(crud.heat_lanes_of(db, heat))
    ]

    assert unrun, "every heat is already raced, so there is nothing to try"


def test_the_preliminaries_are_all_raced(db, seeded):
    """Half a raced round would put a partial leaderboard on screen, which
    reads as the demo being broken rather than as a race in progress."""
    prelim = _prelim_round(db, seeded)

    for heat in crud.get_heats(db, seeded.id, round_id=prelim.id):
        assert lanes.has_results(crud.heat_lanes_of(db, heat))


def test_every_raced_lane_has_a_place(db, seeded):
    """A time with no place is a half-finished hand entry, and under POINTS a
    missing placement scores *better* (#225). The demo must not ship the shape
    four separate bugs have arrived by."""
    prelim = _prelim_round(db, seeded)

    for heat in crud.get_heats(db, seeded.id, round_id=prelim.id):
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id is not None:
                assert lane.place is not None, f"lane {lane.lane} has no place"


def test_places_follow_the_times(db, seeded):
    """Invented values still have to be internally consistent. A leaderboard
    that disagrees with the heat times is the first thing an evaluator notices,
    and it would be entirely our own doing."""
    prelim = _prelim_round(db, seeded)

    for heat in crud.get_heats(db, seeded.id, round_id=prelim.id):
        raced = [
            lane for lane in crud.heat_lanes_of(db, heat) if lane.racer_id is not None
        ]
        by_time = [lane.lane for lane in sorted(raced, key=lambda x: x.time)]
        by_place = [lane.lane for lane in sorted(raced, key=lambda x: x.place)]

        assert by_time == by_place


def test_the_times_are_plausible(db, seeded):
    """A demo reporting 0.4s or 40s teaches an evaluator the app is a toy."""
    prelim = _prelim_round(db, seeded)

    for heat in crud.get_heats(db, seeded.id, round_id=prelim.id):
        for lane in crud.heat_lanes_of(db, heat):
            if lane.racer_id is not None:
                assert demo_content._FASTEST <= lane.time <= demo_content._SLOWEST


# --------------------------------------------------------------------------- #
# Repeatability                                                                #
# --------------------------------------------------------------------------- #


def test_the_times_are_keyed_rather_than_sequential(db, seeded, monkeypatch):
    """`demo_seed`'s standing rule, restated for this module: a draw keyed on a
    database id gives the same demo different answers depending on how much was
    created before it. The key here is the race *name* and the heat *number*,
    so the same heat gets the same time whatever ran first."""
    monkeypatch.setenv(demo_seed.SEED_VARIABLE, "demo-content-test")

    first = demo_content._results_for(db, crud.get_heats(db, seeded.id)[0], seeded.name)
    second = demo_content._results_for(
        db, crud.get_heats(db, seeded.id)[0], seeded.name
    )

    assert [lane.time for lane in first] == [lane.time for lane in second]


def test_an_unseeded_install_draws_freely(db, seeded, monkeypatch):
    """The seed stays opt-in. Left on in ordinary use a re-run heat would report
    the identical time to three decimal places, which reads as the app being
    broken rather than as the data being invented."""
    monkeypatch.delenv(demo_seed.SEED_VARIABLE, raising=False)

    heat = crud.get_heats(db, seeded.id)[0]
    draws = {
        tuple(lane.time for lane in demo_content._results_for(db, heat, seeded.name))
        for _ in range(5)
    }

    assert len(draws) > 1


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


def _prelim_round(db, race):
    return next(
        r
        for r in sorted(crud.get_rounds(db, race.id), key=lambda r: r.round_number)
        if r.advancement_source is None
    )


def _final_round(db, race):
    return next(
        r
        for r in sorted(crud.get_rounds(db, race.id), key=lambda r: r.round_number)
        if r.advancement_source is not None
    )
