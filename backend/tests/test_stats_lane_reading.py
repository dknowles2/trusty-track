"""Statistics survive a heat they cannot read anything from.

`compute_race_stats` parsed `lane_results` itself until #5 moved it onto the
codec, and #72 moved it onto `heat_lanes`. This file used to feed it malformed
blobs — an object rather than a list, a list of strings, an entry with no lane
number — because `json.loads` would iterate them and raise inside the stats
page, taking the whole thing down mid-event.

**None of those are representable now.** There is no string to malform: a
heat's lanes are rows, and a lane with no number cannot be one. What survives
is the case that is still reachable and still matters — a heat with no lane
rows at all, which is what an unreadable blob became when migration 0003
backfilled the table.
"""

import pytest

from backend.db import crud, models, schemas
from backend.services.stats import compute_race_stats
from backend.tests.helpers import as_lanes


@pytest.fixture
def race(db):
    group = crud.create_organization(db, schemas.OrganizationCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            organization_id=group.id,
            track_id=track.id,
            scoring_strategy="TIMED",
            car_numbering_strategy="MANUAL",
        ),
    )


@pytest.fixture
def racers(db, race):
    return [
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(n),
                car_number=n,
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
        for n in (1, 2)
    ]


def _heat_with(db, race, lane_rows, heat_number=1) -> models.Heat:
    """One official heat holding exactly these lanes."""
    round_obj = crud.create_round(db, race_id=race.id, round_number=heat_number)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        kind=models.HeatKind.OFFICIAL,
        heat_number=heat_number,
    )
    db.add(heat)
    db.flush()
    crud.set_heat_lanes(heat, as_lanes(lane_rows))
    db.commit()
    return heat


def test_a_heat_with_no_lanes_does_not_take_the_stats_page_down(db, race):
    """One unreadable heat must not cost the operator the whole page.

    Statistics are read during an event, on the same machine that is running
    it, and there is nothing the operator could do about a heat they cannot
    see. The rest of the race still has numbers worth showing.
    """
    _heat_with(db, race, [])

    stats = compute_race_stats(db, race.id)

    assert stats is not None
    assert stats["total_heats_completed"] == 0


def test_good_heats_still_count_alongside_a_bad_one(db, race, racers):
    _heat_with(db, race, [], heat_number=1)
    _heat_with(
        db,
        race,
        [
            {"lane": 1, "racer_id": racers[0].id, "time": 3.5, "place": 1},
            {"lane": 2, "racer_id": racers[1].id, "time": 3.9, "place": 2},
        ],
        heat_number=2,
    )

    stats = compute_race_stats(db, race.id)

    assert stats["total_heats_completed"] == 1
    assert {r["racer_id"] for r in stats["racer_stats"]} == {
        racers[0].id,
        racers[1].id,
    }
