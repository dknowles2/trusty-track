"""Which URL a racer's own photo fields may hold (#746).

`uploadImage` (`api/schema.py`) is the one door that writes to `UPLOAD_DIR`
and hands back a `/static/<filename>` path — the shape `POST /upload/`'s
comment already promised for `PhotoAssignmentInput.url`. Everything that
later accepts a racer's photo URL back from a client — `createRacer`,
`updateRacer`, `bulkAssignPhotos` — took that string on faith, with no
validator anywhere in `schemas.py`. That matters because the value is
rendered on every public, unauthenticated audience surface (`RacerAvatar`,
the projector, the slideshow, printables): a raw external URL there points a
child's avatar at whatever the caller named, and it bypasses the guard
`uploadImage` exists for entirely, including the public demo's own denylist
of that mutation (`api/demo_policy.py`) — the very thing that policy was
built to prevent.

`is_valid_photo_url` states the one shape this project's own upload endpoint
ever produces. Nothing here fetches the URL or asks the filesystem whether it
exists — that would be a network round trip (or a dependency on `UPLOAD_DIR`)
inside what is otherwise a pure string check, and the project's own rule/IO
split keeps that decision in the caller if it is ever wanted. Refusing
anything not shaped like `/static/<name>.<ext>` already closes the reported
hole: an absolute URL, a scheme-relative one (`//host/...`), or a path
outside `/static/` are all refused, and a legitimate value is always exactly
what `uploadImage` handed back a moment earlier.
"""

from __future__ import annotations

import re

#: `uploadImage`'s own filename shape: `uuid.uuid4()` plus one of the four
#: extensions it ever writes. The character class is deliberately looser
#: than a strict UUID — existing fixtures across the test suite use plain
#: names like `/static/face.png` — but excludes `/`, `.` (beyond the one
#: separating the extension), and anything else that could smuggle a path
#: traversal, a query string, or a fragment past a naive suffix check.
_PHOTO_URL_RE = re.compile(r"^/static/[A-Za-z0-9_-]+\.(?:png|gif|webp|jpg)$")


def is_valid_photo_url(url: str) -> bool:
    """Whether `url` has the shape `uploadImage` produces.

    Not a general "is this a well-formed URL" check — an absolute URL
    (`https://...`), a protocol-relative one (`//host/...`), or a path
    outside `/static/` all fail this, which is the point: the only
    legitimate value a client ever has for a racer's photo field is a
    string this app handed back moments earlier.
    """
    return bool(_PHOTO_URL_RE.match(url))
