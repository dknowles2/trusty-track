"""`createRound` rolls back its committed row on a generation failure (#415).

`crud.create_round` commits immediately (backend/db/crud.py), which is why
`createRoundWizard` rolls back everything it created so far when
`generate_heats_for_round` raises (#249) — without that, a wizard round joins
the schedule with no heats behind it. `createRound`, the wizard's
single-round sibling, had the identical exposure and no rollback: its
`except ValueError as e: raise ValueError(str(e)) from None` stripped the
exception chain and did nothing else, so a round that failed at generation
(too few racers, say) stayed committed while the mutation reported failure.

This pins the fix: a `createRound` call whose validation passes but whose
`generate_heats_for_round` call fails leaves no round row behind, for both
the general-round and championship-round branches.
"""

from backend.db import crud, models, schemas


def _race(db, racer_count, label):
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} Pack")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=3)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            organization_id=group.id,
            track_id=track.id,
            car_numbering_strategy="MANUAL",
        ),
    )
    for i in range(racer_count):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(i),
                race_id=race.id,
                car_passed_inspection=True,
            ),
        )
    return race


def _rounds(db, race_id):
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def _create_round(client, race_id, **fields):
    return client.post(
        "/graphql",
        json={
            "query": """
            mutation Add($raceId: Int!, $round: RoundCreateInput!) {
                createRound(raceId: $raceId, roundData: $round) { id }
            }
            """,
            "variables": {"raceId": race_id, "round": fields},
        },
    )


def test_a_general_round_that_fails_generation_leaves_no_round_behind(db, client):
    # `generate_heats_for_round` refuses a field under two racers, which
    # `createRound`'s own validation never checks — the failure has to come
    # from generation itself to exercise the rollback this test pins.
    race = _race(db, racer_count=1, label="TooFewGeneral")

    response = _create_round(client, race.id, name="All Pack", runsPerLane=1)

    body = response.json()
    assert "errors" in body, body
    assert "Not enough racers" in body["errors"][0]["message"]
    assert _rounds(db, race.id) == []


def test_a_championship_round_that_fails_generation_leaves_no_round_behind(
    db, client, monkeypatch
):
    # A championship round's placeholder heats rarely fail generation in
    # practice — it schedules placeholders rather than asking the roster for
    # racers — so this forces the same failure `generate_heats_for_round`
    # already raises for other reasons, to pin the rollback for this branch
    # too rather than leaving it exercised only by the general round above.
    race = _race(db, racer_count=10, label="ChampGenFails")

    def _fail(*_args, **_kwargs):
        raise ValueError("Simulated heat generation failure")

    monkeypatch.setattr(crud, "generate_heats_for_round", _fail)

    response = _create_round(
        client,
        race.id,
        name="Finals",
        advancementSource="ALL",
        advancementNumRacers=3,
        runsPerLane=1,
    )

    body = response.json()
    assert "errors" in body, body
    assert "Simulated heat generation failure" in body["errors"][0]["message"]
    assert _rounds(db, race.id) == []
