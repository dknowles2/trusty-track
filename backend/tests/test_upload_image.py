"""Tests for the `uploadImage` mutation body and size caps (#744).

Verifies that `uploadImage` enforces `MAX_UPLOAD_BYTES` (16 MB) both on the
caller-supplied `data_url` string length (before base64 decoding) and on the
decoded raw bytes, refusing oversized payloads before allocating memory or
writing to disk.
"""

import base64
import os
from typing import Any

from starlette.testclient import TestClient

from backend.api import schema
from backend.db.database import UPLOAD_DIR

# Minimal 1x1 PNG bytes for valid image tests
_TINY_PNG: bytes = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _png_data_url(raw: bytes = _TINY_PNG) -> str:
    """Encode raw bytes as a base64 PNG data URL."""
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def test_upload_image_exceeding_data_url_length_is_refused(
    monkeypatch: Any,
) -> None:
    """A data_url string larger than the base64 equivalent cap is refused
    before decoding.
    """
    monkeypatch.setattr(schema, "MAX_UPLOAD_BYTES", 1024)
    mutation = schema.Mutation()

    # Base64 equivalent for 1024 bytes is ((1024+2)//3)*4 = 1368 chars.
    # A string exceeding max_b64_len + 1024 should be rejected immediately.
    huge_data_url = "data:image/png;base64," + ("A" * 3000)

    before_files = set(os.listdir(UPLOAD_DIR))
    try:
        mutation.upload_image(huge_data_url)
    except ValueError as err:
        assert "Image is larger than" in str(err)
    else:
        raise AssertionError("Expected ValueError for oversized data_url")

    assert set(os.listdir(UPLOAD_DIR)) == before_files


def test_upload_image_exceeding_decoded_bytes_is_refused(
    monkeypatch: Any,
) -> None:
    """A data_url within string length margin but whose decoded bytes exceed
    MAX_UPLOAD_BYTES is refused.
    """
    monkeypatch.setattr(schema, "MAX_UPLOAD_BYTES", 100)
    mutation = schema.Mutation()

    # 150 bytes of decoded data is over the 100-byte cap
    data_url = _png_data_url(b"x" * 150)

    before_files = set(os.listdir(UPLOAD_DIR))
    try:
        mutation.upload_image(data_url)
    except ValueError as err:
        assert "Image is larger than" in str(err)
    else:
        raise AssertionError("Expected ValueError for oversized decoded bytes")

    assert set(os.listdir(UPLOAD_DIR)) == before_files


def test_upload_image_mutation_refuses_oversized_image_via_graphql(
    client: TestClient, monkeypatch: Any
) -> None:
    """GraphQL POST /graphql returns an informative error when uploadImage
    payload is oversized.
    """
    monkeypatch.setattr(schema, "MAX_UPLOAD_BYTES", 1024)

    huge_data_url = "data:image/png;base64," + ("A" * 3000)
    response = client.post(
        "/graphql",
        json={
            "query": "mutation($d: String!) { uploadImage(dataUrl: $d) }",
            "variables": {"d": huge_data_url},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "Image is larger than" in payload["errors"][0]["message"]


def test_upload_image_refuses_malformed_data_url() -> None:
    """A data_url without comma or with invalid base64 is refused with ValueError."""
    mutation = schema.Mutation()

    try:
        mutation.upload_image("not-a-valid-data-url")
    except ValueError as err:
        assert "Invalid data URL format" in str(err)
    else:
        raise AssertionError("Expected ValueError for missing comma")

    try:
        mutation.upload_image("data:image/png;base64,!!!not_base64!!!")
    except ValueError as err:
        assert "Invalid data URL format" in str(err)
    else:
        raise AssertionError("Expected ValueError for invalid base64")


def test_upload_image_within_limit_succeeds() -> None:
    """An image within the limit succeeds and writes a file to UPLOAD_DIR."""
    mutation = schema.Mutation()
    data_url = _png_data_url(_TINY_PNG)

    result_url = mutation.upload_image(data_url)
    assert result_url.startswith("/static/")
    assert result_url.endswith(".png")

    filename = result_url.split("/static/")[1]
    saved_path = os.path.join(UPLOAD_DIR, filename)
    assert os.path.exists(saved_path)

    # Clean up written file
    os.remove(saved_path)


def test_max_upload_bytes_matches_production_cap() -> None:
    """MAX_UPLOAD_BYTES in schema matches the 16 MB production cap (#744)."""
    assert schema.MAX_UPLOAD_BYTES == 16 * 1024 * 1024


def test_upload_image_refuses_unreadable_bytes() -> None:
    """Garbage bytes used to reach Pillow's own `UnidentifiedImageError`
    uncaught (#885); the resolver should refuse with a plain sentence, the
    same shape every other refusal in this mutation already uses."""
    mutation = schema.Mutation()

    garbage_data_url = "data:image/jpeg;base64," + base64.b64encode(
        b"not an image, just some text"
    ).decode("ascii")

    try:
        mutation.upload_image(garbage_data_url)
    except ValueError as err:
        assert "not a photo" in str(err)
    else:
        raise AssertionError("Expected ValueError for unreadable image bytes")


def test_upload_image_mutation_refuses_unreadable_bytes_via_graphql(
    client: TestClient,
) -> None:
    """Same refusal, through the actual GraphQL round trip: an uncaught
    `UnidentifiedImageError` used to surface as an opaque 500-shaped GraphQL
    error rather than this message."""
    garbage_data_url = "data:image/jpeg;base64," + base64.b64encode(
        b"not an image, just some text"
    ).decode("ascii")

    response = client.post(
        "/graphql",
        json={
            "query": "mutation($d: String!) { uploadImage(dataUrl: $d) }",
            "variables": {"d": garbage_data_url},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert "errors" in payload
    assert "not a photo" in payload["errors"][0]["message"]
