"""#346: `createTrack` registered a `TimerManager` for a backend-direct track
but never started it — unlike `updateInitialConfig`'s new-track branch, which
calls `_start_backend_direct` right after registering. A track created this
way sat DISCONNECTED until something else happened to kick it, such as the
operator flipping the timer type back and forth.
"""

from backend.api import main as main_module
from backend.api import schema as schema_module


def _isolated_timer_managers(monkeypatch):
    """`TIMER_MANAGERS` is a module-global dict, one per process, and the
    context builder reads it fresh on every request — so replacing it here
    keeps this test's track from colliding with a manager an earlier test in
    the same worker already registered under the same (reused, in-memory-db)
    track id.
    """
    fresh: dict = {}
    monkeypatch.setattr(main_module, "TIMER_MANAGERS", fresh)
    return fresh


def test_creating_an_auto_detect_backend_track_starts_the_search(client, monkeypatch):
    _isolated_timer_managers(monkeypatch)
    calls = []
    monkeypatch.setattr(
        schema_module,
        "_start_backend_direct",
        lambda _mgr, port, profile=None: calls.append((port, profile)),
    )

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation {
                createTrack(track: {
                    name: "Backend Direct Track",
                    laneCount: 4,
                    timerType: "AUTO_DETECT_BACKEND"
                }) { id }
            }
            """
        },
    )

    assert "errors" not in response.json(), response.json()
    assert calls == [(None, None)]


def test_creating_a_fake_track_does_not_start_a_search(client, monkeypatch):
    """The fake timer needs no port search — starting one would be pointless
    work and, on real hardware, a probe writing to every port it finds."""
    _isolated_timer_managers(monkeypatch)
    calls = []
    monkeypatch.setattr(
        schema_module,
        "_start_backend_direct",
        lambda _mgr, port, profile=None: calls.append((port, profile)),
    )

    response = client.post(
        "/graphql",
        json={
            "query": """
            mutation {
                createTrack(track: {
                    name: "Fake Track",
                    laneCount: 4,
                    timerType: "FAKE"
                }) { id }
            }
            """
        },
    )

    assert "errors" not in response.json(), response.json()
    assert calls == []
