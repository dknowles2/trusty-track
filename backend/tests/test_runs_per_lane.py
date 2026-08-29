"""``runsPerLane`` means the same thing for every round (#143).

The wizard and `createRound` both collect it per round, and `docs/race-day.md`
calls it configurable. General rounds honoured it; championship rounds ran
`for i in range(1)` under a comment reading "Championship rounds: 1 run per
lane", which is a note-to-self rather than a decision — so an operator asking
for a two-run final quietly got a one-run final.

Nothing failed while it was inert, because nothing asked. Every test here is
one of the questions nobody was asking.

PPC makes one heat per participant per run, so the arithmetic throughout is
``heats == participants * runs``.
"""

from backend.db import crud, models, schemas


def _race(db, lane_count=3, racer_count=6, label="Runs"):
    group = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} Pack")
    )
    track = crud.create_track(
        db,
        schemas.TrackCreate(name=f"{label} Track", lane_count=lane_count),
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


def _heats_in(db, round_id):
    return db.query(models.Heat).filter(models.Heat.round_id == round_id).count()


def _rounds(db, race_id):
    return (
        db.query(models.Round)
        .filter(models.Round.race_id == race_id)
        .order_by(models.Round.round_number)
        .all()
    )


def test_the_wizard_gives_a_championship_the_runs_it_was_asked_for(db, client):
    race = _race(db, label="WizardRuns")

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Grand Finals",
                            "source": "ALL",
                            "numTopRacers": 3,
                            "runsPerLane": 2,
                        }
                    ],
                },
            },
        },
    )
    assert "errors" not in response.json(), response.json()

    prelim, final = _rounds(db, race.id)
    assert _heats_in(db, prelim.id) == 6  # 6 racers, one run
    # Three finalists, twice: the field the operator asked to race twice.
    assert _heats_in(db, final.id) == 6


def test_create_round_gives_a_championship_the_runs_it_was_asked_for(db, client):
    """The other door. `RoundCreateInput` has carried the field all along."""
    race = _race(db, label="CreateRuns")

    def create(**fields):
        response = client.post(
            "/graphql",
            json={
                "query": """
                mutation Add($raceId: Int!, $round: RoundCreateInput!) {
                    createRound(raceId: $raceId, roundData: $round) { id }
                }
                """,
                "variables": {"raceId": race.id, "round": fields},
            },
        )
        assert "errors" not in response.json(), response.json()

    create(name="All Pack", runsPerLane=1)
    create(
        name="Finals",
        advancementSource="ALL",
        advancementNumRacers=3,
        runsPerLane=2,
    )

    _, final = _rounds(db, race.id)
    assert _heats_in(db, final.id) == 6


def test_regenerating_a_multi_run_championship_keeps_its_runs(db, client):
    """Regeneration recovers the run count from the heats that are there.

    It used to infer that only for general rounds and assume one run for a
    championship, so regenerating a two-run final — which happens on its own,
    every time an earlier result invalidates it — silently halved it.
    """
    race = _race(db, label="RegenRuns")
    client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Grand Finals",
                            "source": "ALL",
                            "numTopRacers": 3,
                            "runsPerLane": 2,
                        }
                    ],
                },
            },
        },
    )
    _, final = _rounds(db, race.id)
    assert _heats_in(db, final.id) == 6

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation Regen($roundId: Int!) { regenerateRound(roundId: $roundId) { id } }
            """,
            "variables": {"roundId": final.id},
        },
    )
    assert "errors" not in response.json(), response.json()

    assert _heats_in(db, final.id) == 6


def test_one_run_is_still_one_run(db, client):
    """The default, and what every existing race has. Doubling a final that
    nobody asked to double would be the worse failure of the two."""
    race = _race(db, label="SingleRun")
    client.post(
        "/graphql",
        json={
            "query": """
            mutation Build($raceId: Int!, $config: WizardConfigurationInput!) {
                createRoundWizard(raceId: $raceId, config: $config) { id }
            }
            """,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Grand Finals",
                            "source": "ALL",
                            "numTopRacers": 3,
                            "runsPerLane": 1,
                        }
                    ],
                },
            },
        },
    )
    _, final = _rounds(db, race.id)
    assert _heats_in(db, final.id) == 3
