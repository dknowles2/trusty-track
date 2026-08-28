"""The public demo refuses what a stranger could use to end it.

Every test that matters here asserts the mutation was **refused** — that the
row is absent, or the value unchanged — rather than that a check ran. Same rule
and same reason as `test_auth_policy.py`: raising from a `SchemaExtension`'s
`on_execute` hook is silently swallowed and the mutation completes, so a guard
can pass its own test while permitting everything.

The other half is that all of it is *off* unless asked for. An operator running
this image on their own hardware must see today's behaviour with nothing to
turn off, so the fixtures here set the flag explicitly and the suite's default
leaves it unset.
"""

import pytest
from fastapi.testclient import TestClient

from backend import demo_mode
from backend.api import demo_policy
from backend.api.schema import schema
from backend.db import crud, models, schemas
from backend.domain import audit


@pytest.fixture
def demo(monkeypatch):
    """Turn the demo on for one test."""
    monkeypatch.setenv(demo_mode.DEMO_VARIABLE, "1")


@pytest.fixture
def group(db):
    """A configured install. Nothing exists in a fresh test database."""
    return crud.create_group(db, schemas.GroupCreate(name="Demo Pack"))


def _mutation_names() -> set[str]:
    """Every mutation the schema declares, read from the SDL.

    Same derivation as `test_auth_policy.py`: the SDL is what a client can
    actually call, which is the thing a policy has to describe.
    """
    body = schema.as_str().split("type Mutation {", 1)[1].split("\n}", 1)[0]
    names = set()
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith(('"', "#")):
            continue
        names.add(line.split("(", 1)[0].split(":", 1)[0].strip())
    return names


# --------------------------------------------------------------------------- #
# The flag                                                                     #
# --------------------------------------------------------------------------- #


def test_the_demo_is_off_by_default(monkeypatch):
    """Which is every install that exists."""
    monkeypatch.delenv(demo_mode.DEMO_VARIABLE, raising=False)
    assert not demo_mode.enabled()


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " 1 "])
def test_truthy_values_turn_it_on(monkeypatch, value):
    monkeypatch.setenv(demo_mode.DEMO_VARIABLE, value)
    assert demo_mode.enabled()


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "maybe"])
def test_anything_else_leaves_it_off(monkeypatch, value):
    """An unrecognised value is *off*. A deploy that fat-fingers the variable
    gets an ordinary install rather than a half-configured demo."""
    monkeypatch.setenv(demo_mode.DEMO_VARIABLE, value)
    assert not demo_mode.enabled()


def test_it_is_read_at_call_time(monkeypatch):
    """Not captured at import, which is what lets one test set it and the next
    one not see it."""
    monkeypatch.setenv(demo_mode.DEMO_VARIABLE, "1")
    assert demo_mode.enabled()
    monkeypatch.delenv(demo_mode.DEMO_VARIABLE)
    assert not demo_mode.enabled()


# --------------------------------------------------------------------------- #
# The denylist cannot go stale                                                 #
# --------------------------------------------------------------------------- #


def test_every_refused_mutation_exists():
    """One direction only, and the asymmetry is the point.

    `test_auth_policy.py` compares its table against the schema in *both*
    directions, because there an unclassified mutation is denied to every role
    and should fail closed. Here the opposite is right: a new mutation is
    ordinary demo behaviour, and requiring every future one to be listed would
    mean the demo silently loses features nobody thought to add here.

    So only the stale-entry direction is checked — a name outliving the
    mutation it referred to, which is how a policy table quietly stops
    describing the schema.
    """
    assert demo_policy.REFUSED_MUTATIONS - _mutation_names() == set(), (
        "the demo denylist names mutations the schema does not have"
    )


def test_the_demo_still_offers_the_race():
    """A demo that refused the interesting half would not be one. Deleting is
    part of what a visitor is here to try, and the reset undoes it."""
    for name in (
        "createRace",
        "deleteRace",
        "createRoundWizard",
        "updateHeatResult",
        "advanceRound",
        "prepareHeat",
        "checkInRacer",
        "createAward",
    ):
        assert name not in demo_policy.REFUSED_MUTATIONS


# --------------------------------------------------------------------------- #
# Refusals, asserted by their absence                                          #
# --------------------------------------------------------------------------- #


CONFIG_MUTATION = """
    mutation {
      updateInitialConfig(config: {groupName: "Demo Pack", tracks: [],
                                   operatorPin: "1234"}) { pinRequired }
    }
"""


class TestTheInstanceCannotBeLockedOut:
    """The demo's single most reachable way to break.

    With no operator PIN set every caller is `OPERATOR` (`api/auth.py`), so
    without this the first visitor to open System Settings owns the instance
    until somebody resets it.
    """

    def test_a_visitor_cannot_set_a_pin(self, client, db, group, demo):  # noqa: ARG002
        client.post("/graphql", json={"query": CONFIG_MUTATION})

        db.expire_all()
        assert db.get(models.Group, group.id).operator_pin_hash is None

    def test_an_ordinary_install_still_can(self, client, db, group):
        """The flag is off, so nothing here changed for an operator."""
        client.post("/graphql", json={"query": CONFIG_MUTATION})

        db.expire_all()
        assert db.get(models.Group, group.id).operator_pin_hash is not None

    def test_the_refusal_is_recorded(self, client, db, group, demo):  # noqa: ARG002
        """Extension order, asserted rather than assumed. `DemoPolicyExtension`
        is listed before `AuditExtension`, so the audit hook wraps it and sees
        the refusal; listed after, nothing would be recorded at all."""
        client.post("/graphql", json={"query": CONFIG_MUTATION})

        entries = (
            db.query(models.AuditEntry)
            .filter(models.AuditEntry.action == "updateInitialConfig")
            .all()
        )
        assert [e.outcome for e in entries] == [audit.Outcome.REFUSED.value]


CREATE_TRACK_MUTATION = """
    mutation {
      createTrack(track: {name: "Visitor's Track", timerType: "AUTO_DETECT_BACKEND",
                           serialPort: "/dev/ttyUSB0"}) { id }
    }
"""


class TestTracksCannotBeReconfigured:
    """The other door into the serial probing `initialize_timer_managers`'
    boot-time coercion to FAKE does not cover (#323).

    `createTrack`/`updateTrack` can set `timerType`/`serialPort` directly,
    which reaches `_start_backend_direct`/`autodetect()` and walks real USB
    serial ports with a caller-supplied device path — after boot, so the
    coercion in `initialize_timer_managers` never runs again to catch it.
    """

    def test_a_visitor_cannot_create_a_track(self, client, db, demo):  # noqa: ARG002
        before = db.query(models.Track).count()

        client.post("/graphql", json={"query": CREATE_TRACK_MUTATION})

        db.expire_all()
        assert db.query(models.Track).count() == before

    def test_an_ordinary_install_can_still_create_one(self, client, db):
        before = db.query(models.Track).count()

        client.post("/graphql", json={"query": CREATE_TRACK_MUTATION})

        db.expire_all()
        assert db.query(models.Track).count() == before + 1

    def test_a_visitor_cannot_change_the_timer_type(
        self,
        client,
        db,
        default_track,
        demo,  # noqa: ARG002
    ):
        mutation = f"""
            mutation {{
              updateTrack(id: {default_track}, track: {{
                timerType: "AUTO_DETECT_BACKEND", serialPort: "/dev/ttyUSB0"
              }}) {{ id }}
            }}
        """
        client.post("/graphql", json={"query": mutation})

        db.expire_all()
        track = db.get(models.Track, default_track)
        assert track.timer_type == models.TimerType.FAKE
        assert track.serial_port is None

    def test_an_ordinary_install_can_still_change_it(self, client, db, default_track):
        mutation = f"""
            mutation {{
              updateTrack(id: {default_track}, track: {{
                timerType: "AUTO_DETECT_BACKEND", serialPort: "/dev/ttyUSB0"
              }}) {{ id }}
            }}
        """
        client.post("/graphql", json={"query": mutation})

        db.expire_all()
        track = db.get(models.Track, default_track)
        assert track.timer_type == models.TimerType.AUTO_DETECT_BACKEND
        assert track.serial_port == "/dev/ttyUSB0"

    def test_the_refusal_is_recorded(self, client, db, default_track, demo):  # noqa: ARG002
        mutation = f"""
            mutation {{
              updateTrack(id: {default_track}, track: {{
                timerType: "AUTO_DETECT_BACKEND"
              }}) {{ id }}
            }}
        """
        client.post("/graphql", json={"query": mutation})

        entries = (
            db.query(models.AuditEntry)
            .filter(models.AuditEntry.action == "updateTrack")
            .all()
        )
        assert [e.outcome for e in entries] == [audit.Outcome.REFUSED.value]


class TestBulkGenerators:
    """Unbounded row creation behind no credential, on an instance other people
    are looking at."""

    def test_populate_creates_nothing(self, client, db, group, default_track, demo):  # noqa: ARG002
        race = crud.create_race(
            db,
            schemas.RaceCreate(
                name="Demo Populate", group_id=group.id, track_id=default_track
            ),
        )
        before = db.query(models.Racer).count()

        client.post(
            "/graphql",
            json={"query": f"mutation {{ populateRace(raceId: {race.id}) }}"},
        )

        db.expire_all()
        assert db.query(models.Racer).count() == before

    def test_the_practice_race_is_not_created(self, client, db, group, demo):  # noqa: ARG002
        before = db.query(models.Race).count()

        client.post(
            "/graphql", json={"query": "mutation { createPracticeRace { id } }"}
        )

        db.expire_all()
        assert db.query(models.Race).count() == before


class TestTheRestRoutes:
    """What the two schema extensions cannot see, so each checks for itself."""

    def test_upload_is_refused(self, client, demo):  # noqa: ARG002
        response = client.post(
            "/upload/", files={"file": ("car.png", b"not-really-an-image", "image/png")}
        )
        assert response.status_code == 403

    def test_backup_is_refused(self, client, demo):  # noqa: ARG002
        assert client.get("/api/backup").status_code == 403

    def test_restore_is_refused(self, client, demo):  # noqa: ARG002
        response = client.post(
            "/api/backup/restore",
            files={"file": ("backup.zip", b"PK\x03\x04", "application/zip")},
        )
        assert response.status_code == 403

    def test_the_timer_socket_is_refused(self, client, default_track, demo):  # noqa: ARG002
        """Closed with the role code, which is what an unconfigured demo would
        send anyway — which of the two reasons applies is not a caller's
        business."""
        with client.websocket_connect(f"/ws/timer/{default_track}") as socket:
            message = socket.receive()

        assert message["type"] == "websocket.close"
        assert message["code"] == 4403


class TestTheFakeTimerIsForced:
    async def test_a_real_timer_type_is_coerced(self, db, demo):  # noqa: ARG002
        """A seed archive carries whatever timer type it was built with, and an
        `AUTO_DETECT_BACKEND` track sends `autodetect()` walking the USB serial
        ports. The mutations that could set one are refused, so this is belt and
        braces — a track that cannot be reconfigured should not be probed."""
        from backend.services.timer.manager import initialize_timer_managers

        track = crud.create_track(
            db,
            schemas.TrackCreate(
                name="Demo Proxy", lane_count=4, timer_type="AUTO_DETECT_BACKEND"
            ),
        )

        registry = {}
        await initialize_timer_managers(registry, session_factory=lambda: db)

        assert registry[track.id]._device.name == "Fake Timer"


# --------------------------------------------------------------------------- #
# Startup                                                                      #
# --------------------------------------------------------------------------- #


class TestStartup:
    """What the lifespan does differently when the flag is set."""

    def test_a_migration_failure_stops_the_process(self, monkeypatch, demo):  # noqa: ARG002
        """An operator can read the log and the app is still there, which is why
        this has always carried on. The demo has nobody to read it: its storage
        is ephemeral, so carrying on means serving an empty or half-migrated
        database to every visitor with nothing to say so."""
        from backend.api import main

        def _explode() -> None:
            raise RuntimeError("alembic said no")

        monkeypatch.setattr(main, "init_db", _explode)

        with (
            pytest.raises(RuntimeError, match="alembic said no"),
            TestClient(main.app),
        ):
            pass

    def test_an_ordinary_install_carries_on(self, monkeypatch):
        """The other half, and the reason the branch exists rather than a
        blanket change: a Pi that cannot migrate is still the operator's app,
        and taking it down at 9am helps nobody.

        Asserts the app is actually serving afterwards, not merely that the
        lifespan raised nothing — a `with TestClient(...): pass` on its own
        proves only that startup did not propagate the exception, which is
        also what it would look like if the app came up half-built and every
        request then 500'd.
        """
        from backend.api import main

        def _explode() -> None:
            raise RuntimeError("alembic said no")

        monkeypatch.setattr(main, "init_db", _explode)
        monkeypatch.setattr(main, "demo_content", _NeverSeeds())

        with TestClient(main.app) as client:
            response = client.get("/health")

        assert response.status_code == 200

    def test_seeding_does_not_run_twice(self, db, monkeypatch, demo):  # noqa: ARG002
        """The flag says nothing about whether this container has run before —
        an always-on host restarts with its data still there, and a second demo
        stacked on the first is not a reset."""
        from backend import demo_content
        from backend.api import main

        crud.create_group(db, schemas.GroupCreate(name="Already Here"))

        calls = []
        monkeypatch.setattr(main, "init_db", lambda: None)
        monkeypatch.setattr(
            demo_content, "seed", lambda session: calls.append(session) or None
        )

        with TestClient(main.app):
            pass

        assert calls == []


class TestTheClientIsTold:
    """`initialConfig.demoMode`, which is how a page served by this server finds
    out what it is. Without it the idle disconnect cannot know to arm itself."""

    QUERY = "{ initialConfig { initialized demoMode } }"

    def test_a_demo_says_so(self, client, group, default_track, demo):  # noqa: ARG002
        data = client.post("/graphql", json={"query": self.QUERY}).json()["data"]

        assert data["initialConfig"]["demoMode"] is True

    def test_an_ordinary_install_does_not(self, client, group, default_track):  # noqa: ARG002
        data = client.post("/graphql", json={"query": self.QUERY}).json()["data"]

        assert data["initialConfig"]["demoMode"] is False

    def test_it_is_reported_before_the_system_is_configured(self, client, demo):  # noqa: ARG002
        """The unconfigured branch answers too. A demo seeds itself before it
        serves, so this is only reachable if seeding failed — and a first-run
        wizard is the one screen that must not be idled out from under somebody
        halfway through it."""
        data = client.post("/graphql", json={"query": self.QUERY}).json()["data"]

        assert data["initialConfig"]["initialized"] is False
        assert data["initialConfig"]["demoMode"] is True


class _NeverSeeds:
    """Stands in for `demo_content` so the non-demo startup test cannot seed."""

    @staticmethod
    def is_seeded(_session: object) -> bool:  # pragma: no cover - not reached
        return True
