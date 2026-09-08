"""Reading back which button an operator clicked on a native alert (#884).

`run_server.py`'s macOS launcher shows a confirmation alert before deleting
the database (`TrustyTrackApp._reset_db`), and getting the comparison wrong
is a real cost in either direction: treating "Cancel" as confirmation
deletes an operator's race data on a "No", and treating "Reset" as a
cancellation leaves the menu item looking broken forever. It was the second
one: `_reset_db` tested `resp.clicked` on the return value of
`rumps.alert(...)`, but rumps 0.4.0's `alert()` returns the plain int
`NSAlert.runModal()` gives back, not an object with a `.clicked` attribute
-- every click of either button raised `AttributeError`, silently, and the
menu item did nothing. The Windows sibling right below it in the same file
compares `MessageBoxW`'s int return against `idyes`, which is the correct
shape -- and that difference is the evidence this branch was never actually
run before shipping.

Kept as its own tiny pure module, sibling to `run_server.py` rather than a
comparison inline in `_reset_db`, for the same reason `http_mode.py`,
`log_viewer.py` and `cert_requirements.py` already are: importing
`run_server` runs its module-level side effects -- creating the platform
data directory, generating a TLS certificate, importing uvicorn and the
whole backend -- at import time, wrong for a unit test. `rumps` itself adds
a second reason on top: it wraps PyObjC/Cocoa and is only importable on
macOS, so a test that had to `import rumps` to exercise this logic could
only ever run on a Mac. This module depends on neither -- it takes the
value `rumps.alert()` already returned, the same split `http_mode`'s
`http_only_enabled` uses for `os.environ.get(...)`.
"""

from __future__ import annotations

#: rumps 0.4.0's `alert()` returns `NSAlert.runModal()` directly, and per
#: rumps' own docstring: "a number representing the button pressed. The
#: 'ok' button is 1 and 'cancel' is 0." Confirmed against rumps 0.4.0's
#: source (the only version `pip install rumps` can currently resolve to,
#: since it is also the only one on PyPI) rather than assumed from the
#: docstring alone: `rumps.py`'s `alert()` ends with
#: `return alert.runModal()`, with no wrapper narrowing or renaming that
#: return value.
RUMPS_ALERT_OK = 1


def confirmed(alert_response: int, *, ok_response: int = RUMPS_ALERT_OK) -> bool:
    """Whether an operator confirmed a `rumps.alert()` -- clicked its `ok`
    button -- rather than cancelling it or dismissing it any other way.

    `ok_response` defaults to `RUMPS_ALERT_OK`, but is a parameter rather
    than a hardcoded comparison so a caller whose alert's default button is
    *not* the confirming one (there is none in this codebase today) is not
    tempted to invert the return value at the call site instead.
    """
    return alert_response == ok_response
