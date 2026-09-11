"""The Round Wizard offering balanced, elimination and the Slowest Race (#943).

Before this the wizard's `WizardGeneralRoundInput` carried a
`scheduling_strategy` field the frontend never set (#751's narrow-track fix
plumbed it through in advance), and `WizardChampionshipRoundInput` had no way
to ask for the bottom of the standings or a car count below the trophy
minimum at all. `createRound` (the Add Round dialog's mutation) already
supported all of this; the wizard's own batch mutation did not carry the
losses/phases/direction fields through to `crud.create_round`, so the wizard
could not actually build the round the operator asked for even once the
frontend started offering the choice.
"""

from backend.db import crud, models, schemas


def _race(db, lane_count=4, racer_count=6, label="WizardStyles"):
    org = crud.create_organization(db, schemas.OrganizationCreate(name=f"{label} Pack"))
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=lane_count)
    )
    race = crud.create_race(
        db,
        schemas.RaceCreate(
            name=f"{label} Race",
            organization_id=org.id,
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


WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
        id
        roundNumber
        name
        schedulingStrategy
        eliminationLosses
        balancedPhases
        advancementFromBottom
    }
}
"""


def test_the_wizard_builds_an_elimination_round_with_a_custom_loss_count(db, client):
    race = _race(db, label="WizardElimCustom")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "ELIMINATION",
                        "eliminationLosses": 2,
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    assert general["schedulingStrategy"] == "ELIMINATION"
    assert general["eliminationLosses"] == 2
    assert general["name"] == "Elimination Round"

    [round_obj] = _rounds(db, race.id)
    assert round_obj.elimination_losses == 2


def test_the_wizard_defaults_elimination_losses_to_three(db, client):
    race = _race(db, label="WizardElimDefault")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "ELIMINATION",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    assert general["eliminationLosses"] == 3


def test_the_wizard_builds_a_balanced_round_with_a_custom_phase_count(db, client):
    race = _race(db, label="WizardBalCustom")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "BALANCED",
                        "balancedPhases": 2,
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    assert general["schedulingStrategy"] == "BALANCED"
    assert general["balancedPhases"] == 2
    assert general["name"] == "Balanced Round"


def test_the_wizard_defaults_balanced_phases_to_the_lane_count(db, client):
    race = _race(db, lane_count=5, label="WizardBalDefault")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "ALL",
                        "runsPerLane": 1,
                        "schedulingStrategy": "BALANCED",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    [general] = body["data"]["createRoundWizard"]
    assert general["balancedPhases"] == 5


def test_an_elimination_general_round_is_never_split_by_racing_group(db, client):
    # `RoundConfigModal` hides the "By {group}" format picker once a style
    # other than PPC is chosen (#943) — a championship round drawn from an
    # elimination or balanced round's standings would be nonsense split
    # across dens the same way an elimination round cannot itself be a
    # championship round. The wizard now enforces the same rule server-side
    # rather than trusting the frontend to never ask for the combination.
    race = _race(db, label="WizardElimEachGroup")
    group = crud.create_racing_group(
        db, schemas.RacingGroupCreate(name="Wolves", color="#123456"), race.id
    )
    for racer in db.query(models.Racer).filter(models.Racer.race_id == race.id):
        racer.racing_group_id = group.id
    db.commit()

    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {
                        "type": "EACH_GROUP",
                        "runsPerLane": 1,
                        "schedulingStrategy": "ELIMINATION",
                    },
                    "championshipRounds": [],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    rounds = body["data"]["createRoundWizard"]
    # One round for the whole race, not one per racing group.
    assert len(rounds) == 1
    assert rounds[0]["name"] == "Elimination Round"


def test_the_wizard_builds_a_slowest_race_championship_round(db, client):
    race = _race(db, label="WizardSlowest")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
            "variables": {
                "raceId": race.id,
                "config": {
                    "generalRound": {"type": "ALL", "runsPerLane": 1},
                    "championshipRounds": [
                        {
                            "name": "Slowest Race",
                            "source": "ALL",
                            "numTopRacers": 2,
                            "runsPerLane": 1,
                            "advancementFromBottom": True,
                        }
                    ],
                },
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    _general, slowest = body["data"]["createRoundWizard"]
    assert slowest["advancementFromBottom"] is True
    assert slowest["name"] == "Slowest Race"

    rounds = _rounds(db, race.id)
    assert rounds[1].advancement_from_bottom is True


def test_the_wizard_still_defaults_a_championship_round_to_the_fastest(db, client):
    race = _race(db, label="WizardFastestDefault")
    response = client.post(
        "/graphql",
        json={
            "query": WIZARD,
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
    body = response.json()
    assert "errors" not in body, body
    _general, finals = body["data"]["createRoundWizard"]
    assert finals["advancementFromBottom"] is False
