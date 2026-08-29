from backend.db import models


def test_wizard_crash_repro(db, client):
    # 1. Create a Race
    organization_obj = models.Organization(name="Test Organization")
    db.add(organization_obj)
    db.commit()
    db.refresh(organization_obj)

    race = models.Race(name="Test Race", organization_id=organization_obj.id)
    db.add(race)
    db.commit()
    db.refresh(race)

    # Needs a track? Race creation via model doesn't enforce it but GraphQL might?
    # Logic in wizard might require track? Defaults to something.
    # Let's add a track just in case.
    track = models.Track(name="Test Track", lane_count=4)
    db.add(track)
    db.commit()
    race.track_id = track.id
    db.commit()

    # 2. Add some racers (just in case logic depends on them)
    # create racing_group
    racing_group = models.RacingGroup(name="RacingGroup 1", race_id=race.id)
    db.add(racing_group)
    db.commit()
    db.refresh(racing_group)

    racer = models.Racer(
        first_name="John",
        last_name="Doe",
        race_id=race.id,
        racing_group_id=racing_group.id,
    )
    db.add(racer)
    db.commit()

    # 3. Call Wizard with NO championship rounds (just general)
    # This should fail if we only have 1 racer (ValueError from crud.py)
    # GraphQL will return error in data or errors
    mutation_no_champ = f"""
    mutation {{
        createRoundWizard(raceId: {race.id}, config: {{
            generalRound: {{ type: "ALL", runsPerLane: 1 }},
            championshipRounds: []
        }}) {{
            id
        }}
    }}
    """

    # We expect this to raise a generic error or handle it.
    # In GraphQL, exceptions in resolvers usually return {"errors": [...], "data": null}
    response = client.post("/graphql", json={"query": mutation_no_champ})
    assert response.status_code == 200  # GraphQL always 200
    assert "errors" in response.json()
    assert "Not enough racers" in response.json()["errors"][0]["message"]

    # Reset for next attempt (rounds exist now? No, previous failed)
    race2 = models.Race(
        name="Test Race 2", organization_id=organization_obj.id, track_id=track.id
    )
    db.add(race2)
    db.commit()
    db.refresh(race2)

    # Add racers to race2 so it succeeds
    den2 = models.RacingGroup(name="RacingGroup 2", race_id=race2.id)
    db.add(den2)
    db.commit()
    db.refresh(den2)

    racer2a = models.Racer(
        first_name="Jane",
        last_name="Doe",
        race_id=race2.id,
        racing_group_id=den2.id,
        car_passed_inspection=True,
    )
    racer2b = models.Racer(
        first_name="Jack",
        last_name="Smith",
        race_id=race2.id,
        racing_group_id=den2.id,
        car_passed_inspection=True,
    )
    db.add(racer2a)
    db.add(racer2b)
    db.commit()

    # 4. Call Wizard WITH championship rounds
    mutation_with_champ = f"""
    mutation {{
        createRoundWizard(raceId: {race2.id}, config: {{
            generalRound: {{ type: "ALL", runsPerLane: 1 }},
            championshipRounds: [{{
                name: "Finals",
                source: "ALL",
                numTopRacers: 3,
                runsPerLane: 1
            }}]
        }}) {{
            id
        }}
    }}
    """

    response = client.post("/graphql", json={"query": mutation_with_champ})
    assert response.status_code == 200
    assert "data" in response.json()
    assert response.json()["data"]["createRoundWizard"] is not None

    # 5. Call Wizard with BAD PAYLOAD
    # GraphQL validation handles type mismatches before execution
    # runsPerLane: "not_an_integer" -> GraphQL will parse error
    mutation_bad = f"""
    mutation {{
        createRoundWizard(raceId: {race2.id}, config: {{
            generalRound: {{ type: "ALL", runsPerLane: "five" }},
            championshipRounds: []
        }}) {{
            id
        }}
    }}
    """
    response = client.post("/graphql", json={"query": mutation_bad})
    # GraphQL returns 200 but with errors for syntax/validation
    assert response.status_code == 200
    assert "errors" in response.json()
    # It might say something like "Expected value of type Int"
