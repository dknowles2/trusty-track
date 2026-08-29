"""`POST /upload/` is guarded, and capped (#15's rule, on a route it missed).

The role policy covers GraphQL mutations, so this route was covered by nothing:
it wrote a permanent file from an unauthenticated request, and read the whole
body into memory to do it. Its GraphQL twin `uploadImage` is classified as a
`CHECKIN` mutation, which is the level this matches — requiring the operator
would make the REST route stricter than the mutation that does the same thing,
and photographing a car is the registration desk's job.

Nothing in the frontend calls this. Images travel as data URLs through
`uploadImage`. Whether the route should exist is a separate question from
whether it should be open, and only the second is settled here.
"""

import base64
import io
import os

import pytest
from PIL import Image

from backend.api import auth, main
from backend.db import crud, schemas


@pytest.fixture
def group(db):
    """A configured install. Nothing exists in a fresh test database."""
    return crud.create_organization(db, schemas.OrganizationCreate(name="Upload Pack"))


@pytest.fixture
def locked(db, group):
    """An install with both PINs set, which is what turns roles on at all."""
    group.operator_pin_hash = auth.hash_pin("1111")
    group.checkin_pin_hash = auth.hash_pin("2222")
    db.commit()
    return group


#: The smallest valid PNG, so the route has something Pillow can open.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)

#: A 1x1 GIF, small and browser-native enough that `convert_to_browser_safe_png`
#: returns it unchanged — the case that used to leave the caller's filename
#: extension in charge of what the file was stored, and served, as.
_GIF = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")


def _jpeg_bytes() -> bytes:
    """A real JPEG small enough to pass through unconverted, built with
    Pillow rather than hand-encoded so it stays valid if the encoder changes."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, format="JPEG")
    return buf.getvalue()


def _tiff_bytes() -> bytes:
    """A format outside the browser-native set, and outside the extension
    allowlist too — used to exercise the defence-in-depth refusal."""
    buf = io.BytesIO()
    Image.new("RGB", (2, 2)).save(buf, format="TIFF")
    return buf.getvalue()


def test_a_viewer_cannot_upload(client, locked):  # noqa: ARG001 - sets the PINs
    """The wall displays hold no credential, and this route writes to the disk."""
    response = client.post("/upload/", files={"file": ("car.png", _PNG, "image/png")})

    assert response.status_code == 403


def test_the_desk_can_upload(client, locked):  # noqa: ARG001 - sets the PINs
    """Check-in, not operator. The desk is who photographs a car."""
    response = client.post(
        "/upload/",
        files={"file": ("car.png", _PNG, "image/png")},
        headers={"x-trustytrack-pin": "2222"},
    )

    assert response.status_code == 200
    assert response.json()["url"].startswith("/static/")


def test_an_unlocked_install_still_uploads(client, group):  # noqa: ARG001
    """No operator PIN means no enforcement, which is every install that has
    not chosen otherwise. This route must not be the one place that differs."""
    response = client.post("/upload/", files={"file": ("car.png", _PNG, "image/png")})

    assert response.status_code == 200


def test_a_body_over_the_cap_is_refused(client, group):  # noqa: ARG001
    """Asserted by the status, but the point is where the refusal happens: the
    body is measured while it is read, not after it is all in memory."""
    oversized = b"\x00" * (main.MAX_UPLOAD_BYTES + 1)

    response = client.post(
        "/upload/", files={"file": ("huge.png", oversized, "image/png")}
    )

    assert response.status_code == 413


def test_nothing_is_written_when_the_body_is_refused(client, group):  # noqa: ARG001
    """A refusal that still left a file would be the whole problem, unfixed."""
    before = set(os.listdir(main.UPLOAD_DIR))

    client.post(
        "/upload/",
        files={
            "file": ("huge.png", b"\x00" * (main.MAX_UPLOAD_BYTES + 1), "image/png")
        },
    )

    assert set(os.listdir(main.UPLOAD_DIR)) == before


def test_the_route_matches_the_mutation_that_does_the_same_thing():
    """Pinned because the levels have to move together. If `uploadImage` were
    ever reclassified, guarding this route at check-in would stop matching it,
    and the REST path would silently become the looser of the two again."""
    assert "uploadImage" in auth.CHECKIN_MUTATIONS


def test_a_polyglot_filename_is_not_trusted_for_its_extension(client, group):  # noqa: ARG001
    """A valid, small, browser-native GIF named `x.html` used to come back as
    `<uuid>.html` and be served from `/static` as HTML on the app's own
    origin (#322) — same-origin script execution against a page that keeps
    the operator PIN in `localStorage`. The extension must come from what the
    bytes actually are, not from the name the caller chose."""
    response = client.post("/upload/", files={"file": ("x.html", _GIF, "text/html")})

    assert response.status_code == 200
    url = response.json()["url"]
    assert url.endswith(".gif"), url
    assert not url.endswith(".html")


def test_the_stored_file_on_disk_is_not_named_by_the_caller(client, group):  # noqa: ARG001
    """Same fix, checked against the disk rather than the response: nothing
    with an `.html`, `.svg` or `.xhtml` extension should exist afterwards."""
    before = set(os.listdir(main.UPLOAD_DIR))

    client.post("/upload/", files={"file": ("shell.svg", _GIF, "image/svg+xml")})

    new_files = set(os.listdir(main.UPLOAD_DIR)) - before
    assert len(new_files) == 1
    (written,) = new_files
    assert written.endswith(".gif")


def test_a_native_jpeg_keeps_its_own_extension(client, group):  # noqa: ARG001
    """Sniffing the content, not forcing everything to `.png` — only a format
    `convert_to_browser_safe_png` actually re-encodes gets `.png`."""
    response = client.post(
        "/upload/", files={"file": ("car.jpg", _jpeg_bytes(), "image/jpeg")}
    )

    assert response.status_code == 200
    assert response.json()["url"].endswith(".jpg")


def test_sniffed_extension_refuses_a_format_outside_the_allowlist():
    """Defence in depth: `convert_to_browser_safe_png` re-encodes anything
    outside the browser-native set to PNG before this is ever consulted, so
    this path is not reachable through the route today — but a caller of the
    helper itself must not silently fall back to trusting anything."""
    with pytest.raises(main.HTTPException) as excinfo:
        main._sniffed_extension(_tiff_bytes())

    assert excinfo.value.status_code == 400
