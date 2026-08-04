"""Statistics read the blob through the codec, not `json.loads`.

`compute_race_stats` parsed `lane_results` itself until it was moved onto
`lanes.parse` — the only sanctioned reader (#5). Mostly that is consolidation:
the module coerces every time with `float()` and skips falsy racer ids, so the
placeholder and string-time cases it used to handle by accident it now handles
on purpose, with the same answers.

What it is *not* the same about is a blob that is not a list of lanes. Reading
that with `json.loads` iterates something that is not a lane and raises inside
the stats page; the codec returns no lanes. Nothing writes such a blob today —
which is exactly why nothing else would catch it if something started.
"""

import json

import pytest

from backend.db import crud, models, schemas
from backend.services.stats import compute_race_stats


@pytest.fixture
def race(db):
    group = crud.create_group(db, schemas.GroupCreate(name="Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name="Track", lane_count=4, timer_type="FAKE")
    )
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Derby",
            group_id=group.id,
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


def _heat_with(db, race, lane_results, heat_number=1) -> models.Heat:
    """One official heat holding exactly this blob.

    Written through the ORM so the `heat_lanes` projection stays in step — a
    raw UPDATE would bypass the session listener and fail the suite's own
    consistency check.
    """
    round_obj = crud.create_round(db, race_id=race.id, round_number=heat_number)
    heat = models.Heat(
        race_id=race.id,
        round_id=round_obj.id,
        kind=models.HeatKind.OFFICIAL,
        heat_number=heat_number,
        lane_results=json.dumps(lane_results),
    )
    db.add(heat)
    db.commit()
    return heat


@pytest.mark.parametrize(
    "blob",
    [
        {"lanes": []},  # an object rather than a list
        ["lane 1", "lane 2"],  # a list of something that is not a lane
        [{"racer_id": 1, "time": 3.4}],  # an entry with no lane number
    ],
    ids=["object", "list-of-strings", "entry-without-a-lane"],
)
def test_a_malformed_blob_does_not_take_the_stats_page_down(db, race, blob):
    """One unreadable heat must not cost the operator the whole page.

    Statistics are read during an event, on the same machine that is running
    it, and there is nothing the operator could do about a heat they cannot
    see. The rest of the race still has numbers worth showing.
    """
    _heat_with(db, race, blob)

    stats = compute_race_stats(db, race.id)

    assert stats is not None
    assert stats["total_heats_completed"] == 0


def test_good_heats_still_count_alongside_a_bad_one(db, race, racers):
    _heat_with(db, race, {"lanes": []}, heat_number=1)
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
