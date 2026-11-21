"""Tests for baseline HTTP security headers (#1360)."""

from pathlib import Path

from backend.api import main
from backend.db.database import UPLOAD_DIR


def _assert_security_headers(response) -> None:
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert response.headers["x-frame-options"] == "SAMEORIGIN"


def test_health_response_carries_security_headers(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    _assert_security_headers(response)


def test_graphql_response_and_413_carry_security_headers(client, monkeypatch) -> None:
    ok = client.post("/graphql", json={"query": "query { version }"})
    assert ok.status_code == 200
    _assert_security_headers(ok)

    monkeypatch.setattr(main, "MAX_GRAPHQL_BODY_BYTES", 10, raising=False)
    too_big = client.post("/graphql", json={"query": "query { version }"})
    assert too_big.status_code == 413
    _assert_security_headers(too_big)


def test_static_upload_response_carries_security_headers(client) -> None:
    target = Path(UPLOAD_DIR) / "security-headers-test.txt"
    target.write_text("hello")
    try:
        response = client.get("/static/security-headers-test.txt")
        assert response.status_code == 200
        _assert_security_headers(response)
    finally:
        target.unlink(missing_ok=True)
