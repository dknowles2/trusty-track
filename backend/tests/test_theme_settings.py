"""Display/Printables theme settings on `Group` (#498, stage 2).

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
    db.query(models.Group).delete()
    db.commit()


def test_an_unconfigured_install_reports_match_app(db: Session):
    """No Group exists yet, so both fields default to the sentinel that
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
    group = models.Group(name="Pack 1")
    db.add(group)
    db.commit()
    db.refresh(group)

    assert group.display_theme == "MATCH_APP"
    assert group.printables_theme == "MATCH_APP"


def test_create_initial_config_accepts_explicit_themes(db: Session):
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
            "groupName": "Pack 42",
            "displayTheme": "old-glory",
            "printablesTheme": "newsprint",
            "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["createInitialConfig"]
    assert data["displayTheme"] == "old-glory"
    assert data["printablesTheme"] == "newsprint"


def test_create_initial_config_defaults_when_omitted(db: Session):
    """The settings wizard always sends a value (every picker defaults to
    Field Uniform / Match App), but the field is optional at the schema
    level, and an omitted one must not violate the column's NOT NULL."""
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
            "groupName": "Pack 42",
            "tracks": [{"name": "Main Track", "laneCount": 4, "timerType": "FAKE"}],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["createInitialConfig"]
    assert data["displayTheme"] == "MATCH_APP"
    assert data["printablesTheme"] == "MATCH_APP"


def test_update_initial_config_sets_both_themes(db: Session):
    _reset(db)
    group = models.Group(name="Pack 1")
    db.add(group)
    track = models.Track(name="T1", lane_count=4)
    db.add(track)
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            displayTheme
            printablesTheme
        }
    }
    """
    variables = {
        "config": {
            "groupName": "Pack 1",
            "displayTheme": "clear-sight",
            "printablesTheme": "sawdust-and-pine",
            "tracks": [],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["updateInitialConfig"]
    assert data["displayTheme"] == "clear-sight"
    assert data["printablesTheme"] == "sawdust-and-pine"


def test_update_initial_config_leaves_the_theme_alone_when_absent(db: Session):
    """Absent means *leave alone*, the same rule `_apply_pins` follows —
    the settings page re-submits the whole config on every save and would
    otherwise reset the theme back to the default whenever the operator
    renamed a track."""
    _reset(db)
    group = models.Group(name="Pack 1", display_theme="old-glory")
    db.add(group)
    track = models.Track(name="T1", lane_count=4)
    db.add(track)
    db.commit()

    mutation = """
    mutation($config: InitialConfigInput!) {
        updateInitialConfig(config: $config) {
            displayTheme
            printablesTheme
        }
    }
    """
    variables = {"config": {"groupName": "Pack 1", "tracks": []}}
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    data = res_data["data"]["updateInitialConfig"]
    # Untouched — no clear flag exists for this field, and none is needed:
    # resetting to the default is an explicit "MATCH_APP", never an absence.
    assert data["displayTheme"] == "old-glory"
    assert data["printablesTheme"] == "MATCH_APP"


def test_update_initial_config_can_explicitly_reset_to_match_app(db: Session):
    """MATCH_APP is itself a real value the operator can send — the
    "clear" equivalent for this field, requiring no separate boolean flag
    the way `clearWeightLimit` does for a field whose off-state is null."""
    _reset(db)
    group = models.Group(name="Pack 1", display_theme="old-glory")
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
            "groupName": "Pack 1",
            "displayTheme": "MATCH_APP",
            "tracks": [],
        }
    }
    response = client.post("/graphql", json={"query": mutation, "variables": variables})
    res_data = response.json()
    assert "errors" not in res_data, res_data
    assert res_data["data"]["updateInitialConfig"]["displayTheme"] == "MATCH_APP"
