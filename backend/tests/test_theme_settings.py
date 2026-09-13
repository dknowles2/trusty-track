"""Display/Printables theme settings on `Organization` (#498, stage 2; #1080
split them into their own `setThemes` mutation).

The App theme is not tested here at all — it lives only in each device's own
`localStorage` and never reaches the server (see `frontend/src/theming/
appTheme.ts`). These two columns are the install-wide half.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.main import app
from backend.db import models

client = TestClient(app)


def _reset(db: Session) -> None:
    db.query(models.Track).delete()
    db.query(models.Organization).delete()
    db.commit()


def test_an_unconfigured_install_reports_match_app(db: Session):
    """No Organization exists yet, so both fields default to the sentinel that
    reproduces today's shipped colours — never null, and never left out of
    the payload."""
    _reset(db)

    query = """
    query {
        initialConfig {
            initialized
            displayTheme
            printablesTheme
        }
    }
    """
    response = client.post("/graphql", json={"query": query})
    data = response.json()["data"]["initialConfig"]
    assert data["initialized"] is False
    assert data["displayTheme"] == "MATCH_APP"
    assert data["printablesTheme"] == "MATCH_APP"


def test_a_fresh_group_defaults_to_match_app(db: Session):
    """The column's own server default, exercised the ordinary way — a
    group created with no explicit values at all."""
    _reset(db)
    group = models.Organization(name="Pack 1")
    db.add(group)
    db.commit()
    db.refresh(group)

    assert group.display_theme == "MATCH_APP"
    assert group.printables_theme == "MATCH_APP"


def test_create_initial_config_defaults_when_omitted(db: Session):
    """`InitialConfigInput` no longer carries either theme field at all
    (#1080) — the wizard creates the organization with the column defaults
    and applies a chosen theme afterward through `setThemes`, once the
    organization exists for that mutation to find."""
    _reset(db)

    mutation = """
    mutation($config: InitialConfigInput!) {
        createInitialConfig(config: $config) {
            displayTheme
            printablesTheme
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "Pack 42",
            "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["createInitialConfig"]
    assert data["displayTheme"] == "MATCH_APP"
    assert data["printablesTheme"] == "MATCH_APP"


def test_create_initial_config_no_longer_accepts_theme_fields(db: Session):
    """A breaking schema change, deliberately (#1080) — a caller still
    sending `displayTheme` on this input gets a GraphQL validation error
    naming the unknown field, not a silently ignored value."""
    _reset(db)

    mutation = """
    mutation($config: InitialConfigInput!) {
        createInitialConfig(config: $config) {
            displayTheme
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "Pack 42",
            "displayTheme": "old-glory",
            "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" in res_data
    assert "displayTheme" in res_data["errors"][0]["message"]


def test_update_initial_config_no_longer_accepts_theme_fields(db: Session):
    _reset(db)
    group = models.Organization(name="Pack 1")
    db.add(group)
    track = models.Track(name="T1", lane_count=4)
    db.add(track)
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            displayTheme
        }
    }
    """
    variables = {
        "config": {
            "organizationName": "Pack 1",
            "displayTheme": "clear-sight",
            "tracks": [],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" in res_data
    assert "displayTheme" in res_data["errors"][0]["message"]


SET_THEMES_MUTATION = """
mutation($displayTheme: String!, $printablesTheme: String!) {
    setThemes(displayTheme: $displayTheme, printablesTheme: $printablesTheme) {
        displayTheme
        printablesTheme
    }
}
"""


def test_set_themes_writes_both_columns(db: Session):
    _reset(db)
    group = models.Organization(name="Pack 1")
    db.add(group)
    db.commit()

    variables = {"displayTheme": "clear-sight", "printablesTheme": "sawdust-and-pine"}
    response = client.post(
        "/graphql", json={"query": SET_THEMES_MUTATION, "variables": variables}
    )
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["setThemes"]
    assert data["displayTheme"] == "clear-sight"
    assert data["printablesTheme"] == "sawdust-and-pine"

    db.expire_all()
    group = db.query(models.Organization).first()
    assert group.display_theme == "clear-sight"
    assert group.printables_theme == "sawdust-and-pine"


def test_set_themes_can_explicitly_reset_to_match_app(db: Session):
    """MATCH_APP is itself a real value the operator can send — the
    "clear" equivalent for this field, requiring no separate boolean flag
    the way `clearWeightLimit` does for a field whose off-state is null."""
    _reset(db)
    group = models.Organization(name="Pack 1", display_theme="old-glory")
    db.add(group)
    db.commit()

    variables = {"displayTheme": "MATCH_APP", "printablesTheme": "MATCH_APP"}
    response = client.post(
        "/graphql", json={"query": SET_THEMES_MUTATION, "variables": variables}
    )
    res_data = response.json()
    assert "errors" not in res_data, res_data
    assert res_data["data"]["setThemes"]["displayTheme"] == "MATCH_APP"


def test_set_themes_refuses_before_the_system_is_configured(db: Session):
    _reset(db)

    variables = {"displayTheme": "old-glory", "printablesTheme": "newsprint"}
    response = client.post(
        "/graphql", json={"query": SET_THEMES_MUTATION, "variables": variables}
    )
    res_data = response.json()
    assert "errors" in res_data
