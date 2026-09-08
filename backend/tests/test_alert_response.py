"""`TrustyTrackApp._reset_db` (dknowles2/trusty-track#884): rumps 0.4.0's
`alert()` returns a plain int (`NSAlert.runModal()`'s own return value), not
an object with a `.clicked` attribute -- `resp.clicked` raised
`AttributeError` on every click of either button, so the "Reset Database"
menu item silently did nothing.

`packaging/alert_response.py` holds the one-line rule that replaces it;
these tests exercise it directly by loading the file rather than
`import`ing it as `packaging.alert_response` (there is no `__init__.py`,
deliberately -- see the module's own docstring) or importing
`packaging.run_server` (which runs real side effects -- creating a platform
data directory, generating a TLS certificate, importing uvicorn and the
whole backend -- at module scope, wrong for a unit test, and which also
requires `rumps`, only importable on macOS).

Confirmed against rumps 0.4.0's actual published source (fetched from PyPI
while fixing this issue, not run -- no macOS bundle build available here):
`alert()` ends with `return alert.runModal()`, and rumps' own docstring says
"the 'ok' button is 1 and 'cancel' is 0". `_reset_db` passes
`ok="Reset", cancel="Cancel"`, so 1 is the value a confirming click returns.
"""

import importlib.util
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "packaging" / "alert_response.py"
)


def _load_alert_response():
    spec = importlib.util.spec_from_file_location("alert_response", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


alert_response = _load_alert_response()


def test_rumps_ok_constant_is_one():
    # Pinned separately from the behaviour below: a future edit that changes
    # this constant without meaning to (rather than through `ok_response`)
    # should fail here first, with the clearest possible message.
    assert alert_response.RUMPS_ALERT_OK == 1


def test_confirmed_is_true_for_the_default_button():
    # `ok="Reset"` in `_reset_db` maps to rumps'/NSAlert's default button,
    # NSAlertDefaultReturn == 1 -- the value a click on "Reset" returns.
    assert alert_response.confirmed(1) is True


def test_confirmed_is_false_for_the_alternate_button():
    # `cancel="Cancel"` maps to the alternate button, NSAlertAlternateReturn
    # == 0 -- the value a click on "Cancel" returns. Getting this comparison
    # backwards deletes an operator's database on a "Cancel" click.
    assert alert_response.confirmed(0) is False


def test_confirmed_is_false_for_any_other_value():
    # No third ("other") button is passed to this alert, so NSAlertOtherReturn
    # (-1) should never actually arrive -- but the rule must not treat
    # "not explicitly false" as confirmation either.
    for value in (-1, -2, 2, 6):
        assert alert_response.confirmed(value) is False, value


def test_ok_response_is_overridable_for_a_differently_shaped_alert():
    # Not used anywhere in this codebase today, but exists so a future
    # alert whose confirming button is *not* the default one is not tempted
    # to invert the return value at the call site instead.
    assert alert_response.confirmed(0, ok_response=0) is True
    assert alert_response.confirmed(1, ok_response=0) is False
