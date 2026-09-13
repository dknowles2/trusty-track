"""`createRace` taking a copied round plan, and re-pointing `ROUND:` awards
at the rounds it just built from it (#1088).

`Race.roundPlan` derives the round wizard's own answer back out of a race's
rounds (`domain.round_plan.plan_from_rounds`, unit-tested in
`test_domain_round_plan.py`); this is the storage half — `RaceInput.
roundPlan` reaching `crud.create_rounds_from_plan` (the factored-out body of
`createRoundWizard`, exercised unchanged by the wizard's own test suite) in
the same transaction as the race, its racing groups and its copied awards.
"""

from backend.db import crud, models, schemas

CREATE = """
mutation Create($race: RaceInput!) {
    createRace(race: $race) {
        id
        rounds { id roundNumber name advancementSource advancementNumRacers }
        awards { id name kind source }
    }
}
"""

WIZARD = """
mutation Wizard($raceId: Int!, $config: WizardConfigurationInput!) {
    createRoundWizard(raceId: $raceId, config: $config) {
        id
        advancementSource
    }
}
"""

ROUND_PLAN = """
query Plan($raceId: Int!) {
    race(raceId: $raceId) {
        roundPlan {
            generalRound {
                type
                schedulingStrategy
                runsPerLane
                eliminationLosses
                balancedPhases
            }
            championshipRounds {
                name
                source
                numTopRacers
                runsPerLane
                advancementFromBottom
                sourceRoundId
            }
        }
    }
}
"""


def _context(db, label="RoundPlanCopy"):
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name=f"{label} Organization")
    )
    track = crud.create_track(
        db, schemas.TrackCreate(name=f"{label} Track", lane_count=4)
    )
    return organization.id, track.id


def _create_race(client, organization_id, track_id, name):
    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": name,
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    return body["data"]["createRace"]


def _run_wizard(client, race_id, config):
    response = client.post(
        "/graphql",
        json={"query": WIZARD, "variables": {"raceId": race_id, "config": config}},
    )
    body = response.json()
    assert "errors" not in body, body
    return body["data"]["createRoundWizard"]


def _round_plan(client, race_id):
    response = client.post(
        "/graphql", json={"query": ROUND_PLAN, "variables": {"raceId": race_id}}
    )
    body = response.json()
    assert "errors" not in body, body
    plan = body["data"]["race"]["roundPlan"]
    assert plan is not None
    return plan


def _make_source_race(db, client, *, championship_trophies=3):
    """A wizard-built race: one PPC general round (2 runs per lane), one
    `ALL` top-3 final, and a "Pack Champion" SPEED award on that final."""
    organization_id, track_id = _context(db)
    race = _create_race(client, organization_id, track_id, "Last Year's Derby")
    for i in range(6):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(i),
                race_id=race["id"],
                car_passed_inspection=True,
            ),
        )
    rounds = _run_wizard(
        client,
        race["id"],
        {
            "generalRound": {"type": "ALL", "runsPerLane": 2},
            "championshipRounds": [
                {"name": "Finals", "source": "ALL", "numTopRacers": 3}
            ],
        },
    )
    finals_id = rounds[-1]["id"]
    crud.create_award(
        db,
        race["id"],
        schemas.AwardCreate(
            name="Pack Champion",
            kind=models.AwardKind.SPEED,
            source=f"ROUND:{finals_id}",
            place=1,
        ),
    )
    if championship_trophies != 3:
        crud.update_race(
            db,
            race["id"],
            schemas.RaceUpdate(championship_trophies=championship_trophies),
        )
    return race["id"], finals_id


def test_round_plan_creates_rounds_and_remaps_the_copied_award(db, client):
    source_race_id, finals_id = _make_source_race(db, client)
    plan = _round_plan(client, source_race_id)
    assert plan["generalRound"]["type"] == "ALL"
    assert plan["generalRound"]["runsPerLane"] == 2
    assert len(plan["championshipRounds"]) == 1
    assert plan["championshipRounds"][0]["source"] == "ALL"
    assert plan["championshipRounds"][0]["sourceRoundId"] == finals_id

    organization_id, track_id = _context(db, label="RoundPlanCopyDest")
    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": "This Year's Derby",
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                    "roundPlan": plan,
                    "awards": [
                        {
                            "name": "Pack Champion",
                            "kind": "SPEED",
                            "source": f"ROUND:{finals_id}",
                            "place": 1,
                            "sortOrder": 0,
                            "copiedFromRoundId": finals_id,
                        }
                    ],
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    created = body["data"]["createRace"]

    rounds = created["rounds"]
    assert len(rounds) == 2  # one general, one championship
    general = next(r for r in rounds if r["advancementSource"] is None)
    finals = next(r for r in rounds if r["advancementSource"] is not None)
    assert finals["advancementSource"] == "ALL"
    assert finals["advancementNumRacers"] == 3
    assert general["id"] != finals["id"]

    # The award followed to the *new* race's own final, not the old one —
    # and seeding did not add a second, default set alongside it (the
    # presence guard: `seed_championship_awards` sees this award first).
    assert len(created["awards"]) == 1
    award = created["awards"][0]
    assert award["name"] == "Pack Champion"
    assert award["source"] == f"ROUND:{finals['id']}"


def test_a_plan_with_no_round_awards_still_seeds_the_default_trophies(db, client):
    source_race_id, _finals_id = _make_source_race(db, client, championship_trophies=2)
    plan = _round_plan(client, source_race_id)

    organization_id, track_id = _context(db, label="RoundPlanSeeds")
    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": "This Year's Derby (Seeded)",
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                    "championshipTrophies": 2,
                    "roundPlan": plan,
                    # No awards copied — "Best Paint" only, naming no round.
                    "awards": [
                        {"name": "Best Paint", "kind": "SPECIAL", "sortOrder": 0}
                    ],
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    created = body["data"]["createRace"]

    speed_awards = [a for a in created["awards"] if a["kind"] == "SPEED"]
    assert len(speed_awards) == 2
    finals = next(r for r in created["rounds"] if r["advancementSource"] is not None)
    assert {a["source"] for a in speed_awards} == {f"ROUND:{finals['id']}"}


def test_a_round_scoped_award_naming_a_round_the_plan_did_not_reproduce_is_dropped(
    db, client
):
    """No `roundPlan` at all: `roundMap` is empty, so a `ROUND:`-scoped
    award is dropped exactly as it always was (#722) — the round-remap
    addition must not change behaviour for a copy that brings no plan."""
    organization_id, track_id = _context(db)

    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": "No Plan Race",
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                    "awards": [
                        {
                            "name": "Stale Champion",
                            "kind": "SPEED",
                            "source": "ROUND:999",
                            "place": 1,
                            "sortOrder": 0,
                            "copiedFromRoundId": 999,
                        }
                    ],
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    created = body["data"]["createRace"]
    assert created["awards"] == []
    assert created["rounds"] == []


def test_a_bad_plan_creates_no_race_and_no_groups(db, client):
    """All-or-nothing, the same as `createRoundWizard` — a plan that fails
    validation raises before `create_race`'s own `db.commit()`, so nothing
    flushed for this request survives (#1088)."""
    organization_id, track_id = _context(db)
    races_before = db.query(models.Race).count()
    groups_before = db.query(models.RacingGroup).count()

    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": "Doomed Race",
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                    "racingGroups": [{"name": "Wolves", "color": "#AAB7B8"}],
                    "roundPlan": {
                        "generalRound": {"type": "ALL", "runsPerLane": 1},
                        "championshipRounds": [
                            {
                                "name": "Finals",
                                "source": "ALL",
                                # Invalid: refused before anything is created.
                                "numTopRacers": 0,
                            }
                        ],
                    },
                }
            },
        },
    )
    body = response.json()
    assert "errors" in body

    db.rollback()
    assert db.query(models.Race).count() == races_before
    assert db.query(models.RacingGroup).count() == groups_before


def test_resolve_championship_source_chains_through_an_elimination_general_round(
    db, client
):
    """`create_rounds_from_plan` applies `resolve_championship_source`
    exactly as `createRoundWizard` does — an elimination general round
    rewrites a copied plan's "ALL" championship source to chain to it,
    the same as fresh wizard input would (#1012, #1054)."""
    organization_id, track_id = _context(db, label="RoundPlanElim")
    race = _create_race(client, organization_id, track_id, "Elimination Copy")
    for i in range(6):
        crud.create_racer(
            db,
            schemas.RacerCreate(
                first_name="Racer",
                last_name=str(i),
                race_id=race["id"],
                car_passed_inspection=True,
            ),
        )

    response = client.post(
        "/graphql",
        json={
            "query": CREATE,
            "variables": {
                "race": {
                    "name": "Elimination Copy 2",
                    "organizationId": organization_id,
                    "trackId": track_id,
                    "carNumberingStrategy": "MANUAL",
                    "roundPlan": {
                        "generalRound": {
                            "type": "ALL",
                            "runsPerLane": 1,
                            "schedulingStrategy": "ELIMINATION",
                            "eliminationLosses": 2,
                        },
                        "championshipRounds": [
                            {"name": "Finals", "source": "ALL", "numTopRacers": 1}
                        ],
                    },
                }
            },
        },
    )
    body = response.json()
    assert "errors" not in body, body
    created = body["data"]["createRace"]
    general = next(r for r in created["rounds"] if r["advancementSource"] is None)
    finals = next(r for r in created["rounds"] if r["advancementSource"] is not None)
    assert finals["advancementSource"] == f"ROUND:{general['id']}"
    assert race["id"] != created["id"]
