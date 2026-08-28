"""Rendering a QR code to a PNG.

The only part of printables that has to happen on the server: everything else —
the pit pass, the driver's licence, the sheet of them — is HTML the browser
prints, where the branding and the layout already live. A QR code is the one
thing a page cannot draw for itself without another dependency.

Two kinds share the same rendering: `check_in_png` encodes an app-internal
payload (`backend.domain.printables`, decoded back by the scanner); `url_png`
encodes an ordinary URL, for a phone that is not running Trusty Track and
never will be (#414's voting-page QR code).

Kept out of :mod:`backend.domain` because it renders an image; the rule about
*what a check-in code says* is next door in :mod:`backend.domain.printables`.
"""

from __future__ import annotations

import io

import qrcode
from qrcode.constants import ERROR_CORRECT_Q

from backend.domain import printables

#: Pixels per QR module. At 8 a code prints legibly at about 25 mm, which is
#: what fits on a business-card-sized licence, and the file stays small enough
#: to inline sixty of them on a sheet without the page crawling.
_BOX_SIZE = 8

#: Quiet zone, in modules. Four is the spec's minimum; below it, scanners on a
#: densely laid out sheet start reading a neighbouring code's edge.
_BORDER = 4


def _qr_png(data: str) -> bytes:
    """Render arbitrary text as a QR code PNG.

    Error correction Q (~25%) rather than the usual M: these get handled by
    children, pinned to lanyards or held up on a phone, and scanned in a gym
    under whatever light the building has. The extra redundancy costs a
    slightly denser code and buys back a scan that would otherwise fail on a
    crease or a glare.
    """
    code = qrcode.QRCode(
        version=None,  # Smallest that fits the payload.
        error_correction=ERROR_CORRECT_Q,
        box_size=_BOX_SIZE,
        border=_BORDER,
    )
    code.add_data(data)
    code.make(fit=True)

    buffer = io.BytesIO()
    code.make_image(fill_color="black", back_color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def check_in_png(race_id: int, racer_id: int) -> bytes:
    """A PNG of this racer's check-in code."""
    return _qr_png(printables.encode(race_id, racer_id))


def url_png(url: str) -> bytes:
    """A PNG QR code that opens `url`.

    For the voting page's share step (#414): the address a phone should scan
    to reach the ballot. Unlike the check-in code, this encodes the URL
    itself rather than an app-internal payload — a QR code is worth nothing
    to a phone that is not running Trusty Track, and the whole point here is
    that it is not.
    """
    return _qr_png(url)
