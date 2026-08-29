"""A championship round asking for more racers than can qualify (#48).

``advancement_num_racers`` is a request — "top four" — and a racing group of three
cannot supply it. The round's heats are generated from the request, before
anyone has qualified, so the surplus slots used to sit as placeholders that no
advancement would ever fill. ``heat_session.phase`` reports ``NOT_READY`` while
any placeholder remains and the operator screen offers no controls in that
state, so the round could not be run, edited or skipped.
"""

import pytest
from sqlalchemy.orm import Session

from backend.db import crud, models, schemas
from backend.domain import audit, heat_session, lanes
from backend.tests.helpers import as_lanes, lane_dicts


def _race(db: Session, label: str, racer_count: int) -> tuple:
    """A race with `racer_count` checked-in racers on a four-lane track."""
    crud.create_initial_config(
        db,
        schemas.InitialConfigCreate(
            organization_name=f"Organization {label}",
            tracks=[
                schemas.TrackCreate(
                    name=f"Track {label}",
                    lane_count=4,
                    length_feet=40,
                    timer_type=models.TimerType.FAKE,
                )
            ],
        ),
    )
    group = (
        db.query(models.Organization)
        .filter(models.Organization.name == f"Organization {label}")
        .one()
    )
    track = db.query(models.Track).filter(models.Track.name == f"Track {label}").one()
    crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"Race {label}", organization_id=group.id, track_id=track.id
        ),
    )
    race = db.query(models.Race).filter(models.Race.name == f"Race {label}").one()

    racers = [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name=f"R{i}",
                last_name="T",
                car_number=i + 1,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for i in range(racer_count)
    ]
    db.commit()
    return race, racers


def _run_round(db: Session, race_id: int, round_id: int) -> None:
    """Record a time for every real racer, which triggers advancement."""
    for heat in crud.get_heats(db, race_id, round_id=round_id):
        results = lane_dicts(db, heat)
        for res in results:
            rid = res.get("racer_id")
            if rid is None or rid < 0:
                continue
            res["time"] = 1.0 + rid / 100.0
        crud.record_heat_result(
            db, heat.id, as_lanes(results), source=audit.ResultSource.OPERATOR
        )


def _champ_round(db: Session, race_id: int, slots: int):
    """A finals round wanting the top `slots` of the pack."""
    r2 = crud.create_round(
        db,
        race_id,
        2,
        models.SchedulingStrategy.PPC,
        "Finals",
        advancement_source="ALL",
        advancement_num_racers=slots,
    )
    db.flush()
    crud.generate_heats_for_round(db, r2.id, num_placeholders=slots)
    return r2


@pytest.mark.parametrize("racer_count", [2, 3])
def test_a_short_field_leaves_no_undecided_slot(db: Session, racer_count: int):
    """The bug itself: slot -4 was never filled, in every heat, forever."""
    race, _ = _race(db, f"short{racer_count}", racer_count)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    _run_round(db, race.id, r1.id)

    for heat in crud.get_heats(db, race.id, round_id=r2.id):
        assert not [
            lane for lane in crud.heat_lanes_of(db, heat) if lane.is_placeholder
        ]


def test_a_short_field_leaves_the_round_runnable(db: Session):
    """What the operator actually cares about: the screen has controls."""
    race, _ = _race(db, "runnable", 3)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    _run_round(db, race.id, r1.id)

    phases = {
        heat_session.phase(crud.heat_lanes_of(db, heat), timer_state="IDLE")
        for heat in crud.get_heats(db, race.id, round_id=r2.id)
    }
    assert phases == {heat_session.Phase.WAITING}


def test_the_round_is_rebuilt_for_the_field_that_qualified(db: Session):
    """Three racers get a three-racer schedule, not a four-racer one with a hole."""
    race, racers = _race(db, "rebuilt", 3)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    _run_round(db, race.id, r1.id)

    champ_heats = crud.get_heats(db, race.id, round_id=r2.id)
    assert len(champ_heats) == 3  # one per racer, PPC seeds lane 1 with each

    entered = {
        racer_id
        for heat in champ_heats
        for racer_id in lanes.real_racer_ids(crud.heat_lanes_of(db, heat))
    }
    assert entered == {r.id for r in racers}


def test_an_exact_field_is_filled_without_regenerating(db: Session, monkeypatch):
    """Four qualify for four slots, so the round is filled in place.

    Asserted by watching for a regeneration rather than by comparing heat ids.
    Two reasons ids will not do it: SQLite reuses rowids after a delete, so a
    rebuilt round comes back with the same numbers; and for an *exact* field
    the two paths produce the same schedule anyway, since resolving
    `[-1, -2, -3, -4]` in rank order is the same layout as scheduling the four
    winners in that order.

    So what is asserted is narrower and honest: the short-field path does not
    fire. `invalidate_future_rounds` regenerates this round on *every* prelim
    result by design, so the spy has to look for the rebuild this change
    introduces — the one that passes `racer_ids` — rather than for any rebuild
    at all.
    """
    race, _ = _race(db, "exact", 6)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    rebuilt: list[int] = []
    real_generate = crud.generate_heats_for_round

    def spy(db_, round_id, *args, **kwargs):
        if round_id == r2.id and kwargs.get("racer_ids") is not None:
            rebuilt.append(round_id)
        return real_generate(db_, round_id, *args, **kwargs)

    monkeypatch.setattr(crud, "generate_heats_for_round", spy)

    _run_round(db, race.id, r1.id)

    assert rebuilt == [], "an exact field should be filled in place, not rebuilt"
    assert not [
        lane
        for heat in crud.get_heats(db, race.id, round_id=r2.id)
        for lane in crud.heat_lanes_of(db, heat)
        if lane.is_placeholder
    ]


def test_a_rebuilt_round_numbers_its_heats_from_one(db: Session):
    """Regenerating used to renumber a round's heats to 5..8 rather than 1..4.

    `start_heat_num` was computed from `existing_heats`, the list read *before*
    the delete, so a cleared round started numbering after the heats it had
    just removed — leaving a gap in the race's numbering too.
    """
    race, _ = _race(db, "numbering", 6)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)
    assert [h.heat_number for h in crud.get_heats(db, race.id, round_id=r2.id)] == [
        1,
        2,
        3,
        4,
    ]

    crud.generate_heats_for_round(db, r2.id, num_placeholders=4, clear_existing=True)

    assert [h.heat_number for h in crud.get_heats(db, race.id, round_id=r2.id)] == [
        1,
        2,
        3,
        4,
    ]


def test_stacking_onto_a_round_still_continues_its_numbering(db: Session):
    """The case `start_heat_num` exists for: adding heats without clearing."""
    race, _ = _race(db, "stacking", 4)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    first = [h.heat_number for h in crud.get_heats(db, race.id, round_id=r1.id)]

    crud.generate_heats_for_round(db, r1.id, clear_existing=False)

    numbers = [h.heat_number for h in crud.get_heats(db, race.id, round_id=r1.id)]
    assert numbers == first + [n + len(first) for n in first]


def test_a_raced_round_is_filled_in_place_even_when_short(db: Session):
    """A stale field beats silently wiping heats people ran.

    The same rule `invalidate_future_rounds` follows, and the reason the
    rebuild is guarded by `may_rebuild`. Reaching this state needs a result
    recorded into a round that still holds slots — the operator screen will not
    do it, but `updateHeatResult` does not ask about phase.
    """
    race, _ = _race(db, "raced", 3)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    # Record a time into one championship heat while it still holds slot -4.
    champ = crud.get_heats(db, race.id, round_id=r2.id)
    before_ids = [h.id for h in champ]
    target = champ[0]
    results = lane_dicts(db, target)
    results[0]["time"] = 3.21
    crud.record_heat_result(
        db, target.id, as_lanes(results), source=audit.ResultSource.OPERATOR
    )

    _run_round(db, race.id, r1.id)

    after = crud.get_heats(db, race.id, round_id=r2.id)
    assert [h.id for h in after] == before_ids, "raced heats were wiped"
    assert any(
        lane.time is not None for heat in after for lane in crud.heat_lanes_of(db, heat)
    ), "the recorded time was lost"


def test_manual_advance_also_handles_a_short_field(client, db: Session):
    """`advanceRound` had its own copy of the call, so its own copy of #48.

    Driven through the mutation rather than through `populate_round_field`,
    because the bug being fixed here *is* the wiring — a test that calls the
    helper passes whatever the resolver does.
    """
    race, _ = _race(db, "manual", 3)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)

    # Run the prelim before the finals exist, so nothing auto-advances and the
    # manual path is the only thing that fills the field.
    _run_round(db, race.id, r1.id)
    r2 = _champ_round(db, race.id, slots=4)

    resp = client.post(
        "/graphql",
        json={
            "query": """
                mutation Advance($raceId: Int!, $roundId: Int!) {
                    advanceRound(raceId: $raceId, roundId: $roundId)
                }
            """,
            "variables": {"raceId": race.id, "roundId": r2.id},
        },
    )
    assert resp.status_code == 200
    assert resp.json().get("errors") is None, resp.json()
    assert resp.json()["data"]["advanceRound"] == 3

    db.expire_all()
    for heat in crud.get_heats(db, race.id, round_id=r2.id):
        assert not [
            lane for lane in crud.heat_lanes_of(db, heat) if lane.is_placeholder
        ]


def test_populating_with_nobody_changes_nothing(db: Session):
    race, _ = _race(db, "nobody", 3)
    r1 = crud.create_round(db, race.id, 1, models.SchedulingStrategy.PPC, "Prelim")
    db.flush()
    crud.generate_heats_for_round(db, r1.id)
    r2 = _champ_round(db, race.id, slots=4)
    before = [lane_dicts(db, h) for h in crud.get_heats(db, race.id, round_id=r2.id)]

    crud.populate_round_field(db, r2.id, [])

    after = [lane_dicts(db, h) for h in crud.get_heats(db, race.id, round_id=r2.id)]
    assert after == before
