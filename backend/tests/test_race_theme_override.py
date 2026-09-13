"""A race's own Display/Printables theme override (#1081).

`Organization.display_theme`/`printables_theme` (#498, split into `setThemes`
by #1080) already choose these install-wide; this is the second, narrower
layer above them — the same override pattern `Race.terminology` and
`Race.name_display` already use, mirrored in `test_theme_settings.py`'s own
shape.
"""

from sqlalchemy.orm import Session

from backend.db import crud, models, schemas


def _race(db: Session, *, display_theme: str = "MATCH_APP") -> models.Race:
    organization = crud.create_organization(
        db, schemas.OrganizationCreate(name="Pack 1")
    )
    organization.display_theme = display_theme
    db.commit()
    track = crud.create_track(db, schemas.TrackCreate(name="Main Track"))
    return crud.create_race(
        db,
        schemas.RaceCreate(
            name="Rocket Derby", organization_id=organization.id, track_id=track.id
        ),
    )


UPDATE_RACE_THEME_MUTATION = """
mutation($id: Int!, $race: RaceUpdateInput!) {
    updateRace(id: $id, race: $race) {
        id
        displayTheme
        printablesTheme
        resolvedPrintablesTheme
    }
}
"""


def test_a_new_race_inherits_with_no_override_at_all(client, db: Session):
    """Not on the create form by design (#1081) — a freshly created race
    reads null for both raw overrides, and its resolved Printables theme is
    exactly whatever the organization is set to."""
    race = _race(db, display_theme="old-glory")

    query = """
    query($id: Int!) {
        race(raceId: $id) { displayTheme printablesTheme resolvedPrintablesTheme }
    }
    """
    response = client.post(
        "/graphql", json={"query": query, "variables": {"id": race.id}}
    )
    data = response.json()["data"]["race"]
    assert data["displayTheme"] is None
    assert data["printablesTheme"] is None
    assert data["resolvedPrintablesTheme"] == "MATCH_APP"


def test_update_race_sets_the_override(client, db: Session):
    race = _race(db)

    variables = {
        "id": race.id,
        "race": {"displayTheme": "under-the-lights", "printablesTheme": "newsprint"},
    }
    response = client.post(
        "/graphql", json={"query": UPDATE_RACE_THEME_MUTATION, "variables": variables}
    )
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["updateRace"]
    assert data["displayTheme"] == "under-the-lights"
    assert data["printablesTheme"] == "newsprint"
    assert data["resolvedPrintablesTheme"] == "newsprint"

    db.expire_all()
    stored = db.query(models.Race).filter(models.Race.id == race.id).first()
    assert stored.display_theme == "under-the-lights"
    assert stored.printables_theme == "newsprint"


def test_a_race_override_of_match_app_is_a_real_choice_not_the_inherit_state(
    client, db: Session
):
    """`"MATCH_APP"` set on a race pins it to Field Uniform regardless of
    what the install picks later — a different answer from the null this
    race started with, even though both currently resolve to the same
    thing while the install itself is also `MATCH_APP` (#1081)."""
    race = _race(db, display_theme="under-the-lights")

    variables = {"id": race.id, "race": {"printablesTheme": "MATCH_APP"}}
    response = client.post(
        "/graphql", json={"query": UPDATE_RACE_THEME_MUTATION, "variables": variables}
    )
    data = response.json()["data"]["updateRace"]
    assert data["printablesTheme"] == "MATCH_APP"
    assert data["resolvedPrintablesTheme"] == "MATCH_APP"


def test_clear_display_theme_reverts_to_null(client, db: Session):
    race = _race(db, display_theme="old-glory")
    race.display_theme = "newsprint"
    db.add(race)
    db.commit()

    variables = {"id": race.id, "race": {"clearDisplayTheme": True}}
    response = client.post(
        "/graphql", json={"query": UPDATE_RACE_THEME_MUTATION, "variables": variables}
    )
    data = response.json()["data"]["updateRace"]
    assert data["displayTheme"] is None


def test_clear_printables_theme_reverts_the_resolved_value_to_the_install(
    client, db: Session
):
    race = _race(db, display_theme="old-glory")
    race.printables_theme = "newsprint"
    db.add(race)
    db.commit()

    variables = {"id": race.id, "race": {"clearPrintablesTheme": True}}
    response = client.post(
        "/graphql", json={"query": UPDATE_RACE_THEME_MUTATION, "variables": variables}
    )
    data = response.json()["data"]["updateRace"]
    assert data["printablesTheme"] is None
    # The organization's own printables_theme still defaults to MATCH_APP —
    # `_race` above only ever sets `display_theme` on it.
    assert data["resolvedPrintablesTheme"] == "MATCH_APP"


def test_omitting_the_theme_fields_leaves_a_previous_override_alone(
    client, db: Session
):
    """Absent means leave alone, the same rule every other field on
    `RaceUpdateInput` follows (CLAUDE.md) — a save from a form that never
    offered these two controls (the create form, say, if it somehow issued
    an update) must not silently wipe an override set some other way."""
    race = _race(db)
    race.display_theme = "trail-colors"
    db.add(race)
    db.commit()

    variables = {"id": race.id, "race": {"name": "Rocket Derby (renamed)"}}
    response = client.post(
        "/graphql", json={"query": UPDATE_RACE_THEME_MUTATION, "variables": variables}
    )
    data = response.json()["data"]["updateRace"]
    assert data["displayTheme"] == "trail-colors"
