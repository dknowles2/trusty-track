"""Rendering a check-in code to a PNG.

The only part of printables that has to happen on the server: everything else —
the pit pass, the driver's licence, the sheet of them — is HTML the browser
prints, where the branding and the layout already live. A QR code is the one
thing a page cannot draw for itself without another dependency.

Kept out of :mod:`backend.domain` because it renders an image; the rule about
*what the code says* is next door in :mod:`backend.domain.printables`.
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


def check_in_png(race_id: int, racer_id: int) -> bytes:
    """A PNG of this racer's check-in code.

    Error correction Q (~25%) rather than the usual M: these get handled by
    children, pinned to lanyards, and scanned in a gym under whatever light the
    building has. The extra redundancy costs a slightly denser code and buys
    back a scan that would otherwise fail on a crease.
    """
    code = qrcode.QRCode(
        version=None,  # Smallest that fits the payload.
        error_correction=ERROR_CORRECT_Q,
        box_size=_BOX_SIZE,
        border=_BORDER,
    )
    code.add_data(printables.encode(race_id, racer_id))
    code.make(fit=True)

    buffer = io.BytesIO()
    code.make_image(fill_color="black", back_color="white").save(buffer, format="PNG")
    return buffer.getvalue()
