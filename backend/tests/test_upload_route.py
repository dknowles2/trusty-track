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

import os

import pytest

from backend.api import auth, main
from backend.db import crud, schemas


@pytest.fixture
def group(db):
    """A configured install. Nothing exists in a fresh test database."""
    return crud.create_group(db, schemas.GroupCreate(name="Upload Pack"))


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
