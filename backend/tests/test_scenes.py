"""Display scenes over GraphQL (#613): saving a layout, editing it, applying
it to whichever displays actually answer, and the four built-in presets.

Scenes are stored (unlike a `Display`'s own live assignment), so these tests
use the `db` fixture directly for setup and read back through
`backend.db.crud` — the same shape `test_run_off_heats.py` and its siblings
use for a feature with real rows. The presence half comes from
`displays_service.registry`, the same process-wide singleton
`TestAdvanceDisplayMutation` in `test_displays.py` already owns for the
duration of a test.
"""

import pytest

from backend.db import crud, models
from backend.services import displays as displays_service


def _make_race(db, name="Scenes Race"):
    organization = models.Organization(name=f"{name} Org")
    db.add(organization)
    db.commit()
    db.refresh(organization)

    race = models.Race(name=name, organization_id=organization.id)
    db.add(race)
    db.commit()
    db.refresh(race)
    return race


@pytest.fixture(autouse=True)
def clean_registry():
    saved = dict(displays_service.registry._displays)
    displays_service.registry.clear()
    yield
    displays_service.registry.clear()
    displays_service.registry._displays.update(saved)


def _gql(client, query, variables):
    resp = client.post("/graphql", json={"query": query, "variables": variables})
    assert resp.status_code == 200
    body = resp.json()
    assert "errors" not in body, body.get("errors")
    return body["data"]


class TestCrudCapturesTheLiveState:
    def test_create_scene_snapshots_every_known_display(self, db):
        race = _make_race(db)
        crud.create_scene(
            db,
            race.id,
            "My Scene",
            captured=[
                (
                    "d1",
                    "Screen One",
                    crud.Assignment(view=models.DisplayView.PROJECTOR),
                ),
                ("d2", "Screen Two", crud.Assignment()),
            ],
        )

        scenes = crud.get_scenes(db, race.id)
        assert len(scenes) == 1
        names = {a.display_id: a.view for a in scenes[0].assignments}
        assert names == {
            "d1": models.DisplayView.PROJECTOR,
            "d2": models.DisplayView.STANDINGS,
        }

    def test_an_empty_capture_still_creates_a_named_scene(self, db):
        # No displays connected yet — a reserved name, filled in later.
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Empty For Now", captured=[])
        assert scene.assignments == []

    def test_duplicate_names_within_a_race_are_refused(self, db):
        race = _make_race(db)
        crud.create_scene(db, race.id, "Racing", captured=[])
        with pytest.raises(ValueError):
            crud.create_scene(db, race.id, "Racing", captured=[])

    def test_the_same_name_is_fine_in_a_different_race(self, db):
        race_a = _make_race(db, "Race A")
        race_b = _make_race(db, "Race B")
        crud.create_scene(db, race_a.id, "Racing", captured=[])
        # Must not raise.
        crud.create_scene(db, race_b.id, "Racing", captured=[])

    def test_deleting_a_race_deletes_its_scenes(self, db):
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Racing", captured=[])
        db.delete(db.get(models.Race, race.id))
        db.commit()
        assert crud.get_scene(db, scene.id) is None


class TestEditingAScene:
    def test_upsert_adds_a_new_display(self, db):
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Racing", captured=[])

        crud.upsert_scene_display(
            db,
            scene.id,
            "d1",
            "Screen One",
            crud.Assignment(view=models.DisplayView.PROJECTOR),
        )

        scene = crud.get_scene(db, scene.id)
        assert len(scene.assignments) == 1
        assert scene.assignments[0].view == models.DisplayView.PROJECTOR

    def test_upsert_replaces_an_existing_display_rather_than_duplicating(self, db):
        race = _make_race(db)
        scene = crud.create_scene(
            db,
            race.id,
            "Racing",
            captured=[("d1", "Screen One", crud.Assignment())],
        )

        crud.upsert_scene_display(
            db,
            scene.id,
            "d1",
            "Screen One (renamed)",
            crud.Assignment(view=models.DisplayView.AWARDS),
        )

        scene = crud.get_scene(db, scene.id)
        assert len(scene.assignments) == 1
        assert scene.assignments[0].view == models.DisplayView.AWARDS
        assert scene.assignments[0].display_name == "Screen One (renamed)"

    def test_remove_scene_display_drops_only_the_named_one(self, db):
        race = _make_race(db)
        scene = crud.create_scene(
            db,
            race.id,
            "Racing",
            captured=[
                ("d1", "One", crud.Assignment()),
                ("d2", "Two", crud.Assignment()),
            ],
        )

        crud.remove_scene_display(db, scene.id, "d1")

        scene = crud.get_scene(db, scene.id)
        assert [a.display_id for a in scene.assignments] == ["d2"]

    def test_rename_scene(self, db):
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Old Name", captured=[])
        crud.rename_scene(db, scene.id, "New Name")
        assert crud.get_scene(db, scene.id).name == "New Name"

    def test_rename_to_a_taken_name_is_refused(self, db):
        race = _make_race(db)
        crud.create_scene(db, race.id, "Racing", captured=[])
        awards = crud.create_scene(db, race.id, "Awards", captured=[])
        with pytest.raises(ValueError):
            crud.rename_scene(db, awards.id, "Racing")

    def test_delete_scene(self, db):
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Racing", captured=[])
        assert crud.delete_scene(db, scene.id) is True
        assert crud.get_scene(db, scene.id) is None
        assert crud.delete_scene(db, scene.id) is False


CREATE_SCENE = """
mutation($raceId: Int!, $name: String!) {
  createScene(raceId: $raceId, name: $name) {
    id
    name
    assignments { displayId displayName view }
  }
}
"""

APPLY_SCENE = """
mutation($sceneId: Int!) {
  applyScene(sceneId: $sceneId) {
    sceneId
    appliedCount
    skippedCount
    outcomes { displayId displayName applied }
  }
}
"""

APPLY_SCENE_PRESET = """
mutation($raceId: Int!, $preset: ScenePreset!) {
  applyScenePreset(raceId: $raceId, preset: $preset) {
    sceneId
    appliedCount
    skippedCount
    outcomes { displayId displayName applied }
  }
}
"""

UPDATE_SCENE_DISPLAY = """
mutation(
  $sceneId: Int!
  $displayId: String!
  $displayName: String!
  $view: DisplayView!
) {
  updateSceneDisplay(
    sceneId: $sceneId
    displayId: $displayId
    displayName: $displayName
    view: $view
  ) {
    assignments { displayId view }
  }
}
"""

DELETE_SCENE = """
mutation($id: Int!) {
  deleteScene(id: $id)
}
"""

SCENES_QUERY = """
query($raceId: Int!) {
  scenes(raceId: $raceId) { id name }
}
"""

SCENE_PRESETS_QUERY = """
query {
  scenePresets { key label }
}
"""


class TestGraphQL:
    def test_create_scene_captures_currently_known_displays(self, db, client):
        race = _make_race(db)
        displays_service.registry.connect("d1", race_id=race.id, name="Main")
        displays_service.registry.assign("d1", models.DisplayView.PROJECTOR)

        data = _gql(client, CREATE_SCENE, {"raceId": race.id, "name": "Racing"})

        assert data["createScene"]["name"] == "Racing"
        assert data["createScene"]["assignments"] == [
            {"displayId": "d1", "displayName": "Main", "view": "PROJECTOR"}
        ]

    def test_scenes_query_lists_saved_scenes(self, db, client):
        race = _make_race(db)
        crud.create_scene(db, race.id, "Racing", captured=[])

        data = _gql(client, SCENES_QUERY, {"raceId": race.id})

        assert [s["name"] for s in data["scenes"]] == ["Racing"]

    def test_scene_presets_query_lists_the_four_built_ins(self, client):
        data = _gql(client, SCENE_PRESETS_QUERY, {})
        keys = {p["key"] for p in data["scenePresets"]}
        assert keys == {"CHECK_IN", "RACING", "INTERMISSION", "AWARDS"}

    def test_apply_scene_updates_connected_displays_and_reports_them(self, db, client):
        race = _make_race(db)
        displays_service.registry.connect("d1", race_id=race.id, name="Main")
        scene = crud.create_scene(
            db,
            race.id,
            "Racing",
            captured=[
                ("d1", "Main", crud.Assignment(view=models.DisplayView.PROJECTOR))
            ],
        )

        data = _gql(client, APPLY_SCENE, {"sceneId": scene.id})

        assert data["applyScene"]["appliedCount"] == 1
        assert data["applyScene"]["skippedCount"] == 0
        assert displays_service.registry.get("d1").assignment.view == (
            models.DisplayView.PROJECTOR
        )
        assert displays_service.registry.get("d1").assigned is True

    def test_apply_scene_skips_a_display_that_has_gone_quiet(self, db, client):
        # A saved scene can outlive a screen's presence entirely (a restart
        # forgets the in-memory registry) — applying the rest must not fail
        # because one entry cannot be reached.
        race = _make_race(db)
        scene = crud.create_scene(
            db,
            race.id,
            "Racing",
            captured=[
                (
                    "ghost",
                    "Gone",
                    crud.Assignment(view=models.DisplayView.PROJECTOR),
                )
            ],
        )

        data = _gql(client, APPLY_SCENE, {"sceneId": scene.id})

        assert data["applyScene"]["appliedCount"] == 0
        assert data["applyScene"]["skippedCount"] == 1
        assert data["applyScene"]["outcomes"] == [
            {"displayId": "ghost", "displayName": "Gone", "applied": False}
        ]

    def test_apply_scene_preset_assigns_roles_in_connected_first_order(
        self, db, client
    ):
        race = _make_race(db)
        # Connected first, then by name is `DisplayRegistry.for_race`'s own
        # order — a quiet display sorts after a live one regardless of name.
        displays_service.registry.connect("d1", race_id=race.id, name="Zeta")
        displays_service.registry.connect("d2", race_id=race.id, name="Alpha")
        displays_service.registry.disconnect("d1")

        data = _gql(client, APPLY_SCENE_PRESET, {"raceId": race.id, "preset": "RACING"})

        assert data["applyScenePreset"]["sceneId"] is None
        outcomes = {o["displayId"]: o for o in data["applyScenePreset"]["outcomes"]}
        assert outcomes["d1"]["applied"] is True
        assert outcomes["d2"]["applied"] is True
        # d2 is connected and sorts first; it gets the first role (PROJECTOR).
        assert displays_service.registry.get("d2").assignment.view == (
            models.DisplayView.PROJECTOR
        )

    def test_update_scene_display_keeps_unspecified_riders(self, db, client):
        race = _make_race(db)
        scene = crud.create_scene(
            db,
            race.id,
            "Racing",
            captured=[
                (
                    "d1",
                    "Main",
                    crud.Assignment(
                        view=models.DisplayView.CHECKIN, show_checked_in=False
                    ),
                )
            ],
        )

        # Change only the view; showCheckedIn is omitted and must survive.
        _gql(
            client,
            UPDATE_SCENE_DISPLAY,
            {
                "sceneId": scene.id,
                "displayId": "d1",
                "displayName": "Main",
                "view": "CHECKIN",
            },
        )

        row = crud.get_scene(db, scene.id).assignments[0]
        assert row.show_checked_in is False

    def test_delete_scene_removes_it_from_the_list(self, db, client):
        race = _make_race(db)
        scene = crud.create_scene(db, race.id, "Racing", captured=[])

        data = _gql(client, DELETE_SCENE, {"id": scene.id})
        assert data["deleteScene"] is True

        data = _gql(client, SCENES_QUERY, {"raceId": race.id})
        assert data["scenes"] == []

    def test_viewer_cannot_create_a_scene(self, db, client):
        race = _make_race(db)
        organization = (
            db.query(models.Organization).filter_by(id=race.organization_id).first()
        )
        organization.operator_pin_hash = "salt$hash"
        db.commit()

        resp = client.post(
            "/graphql",
            json={
                "query": CREATE_SCENE,
                "variables": {"raceId": race.id, "name": "Racing"},
            },
        )
        body = resp.json()
        assert body.get("errors"), "a VIEWER must not be able to create a scene"
