"""Plain HTTP vs HTTPS, opted into by `TRUSTYTRACK_HTTP_ONLY` (#593).

`packaging/http_mode.py` holds the rule; these tests exercise it directly by
loading the file rather than `import`ing it as `packaging.http_mode` (there
is no `__init__.py`, deliberately — see the module's own docstring) or
importing `packaging.run_server` (which runs real side effects — creating a
platform data directory, generating a TLS certificate, importing uvicorn and
the whole backend — at module scope, wrong for a unit test).
"""

import importlib.util
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "packaging" / "http_mode.py"
)


def _load_http_mode():
    spec = importlib.util.spec_from_file_location("http_mode", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


http_mode = _load_http_mode()


# ── http_only_enabled ───────────────────────────────────────────────────────


def test_absent_value_is_not_http_only():
    assert http_mode.http_only_enabled(None) is False


def test_empty_string_is_not_http_only():
    assert http_mode.http_only_enabled("") is False


def test_an_unrecognised_string_is_not_http_only():
    # Fails closed: HTTPS (the safer, camera-capable default) is what a typo
    # in the environment produces, not the other way round.
    assert http_mode.http_only_enabled("please") is False


def test_recognised_truthy_values_enable_http_only():
    for value in ("1", "true", "True", "TRUE", "yes", "Yes", "on", "ON"):
        assert http_mode.http_only_enabled(value) is True, value


def test_surrounding_whitespace_is_tolerated():
    assert http_mode.http_only_enabled("  1  ") is True
    assert http_mode.http_only_enabled(" true ") is True


def test_zero_is_not_http_only():
    assert http_mode.http_only_enabled("0") is False


# ── scheme ───────────────────────────────────────────────────────────────


def test_scheme_is_https_by_default():
    assert http_mode.scheme(False) == "https"


def test_scheme_is_http_when_http_only():
    assert http_mode.scheme(True) == "http"


# ── needs_certificate ───────────────────────────────────────────────────────


def test_a_certificate_is_needed_unless_http_only():
    assert http_mode.needs_certificate(False) is True
    assert http_mode.needs_certificate(True) is False


# ── uvicorn_ssl_kwargs ──────────────────────────────────────────────────────


def test_ssl_kwargs_are_empty_when_http_only():
    cert = Path("/tmp/server.crt")
    key = Path("/tmp/server.key")
    assert http_mode.uvicorn_ssl_kwargs(True, cert, key) == {}


def test_ssl_kwargs_carry_both_paths_as_strings_when_not_http_only():
    cert = Path("/tmp/server.crt")
    key = Path("/tmp/server.key")
    kwargs = http_mode.uvicorn_ssl_kwargs(False, cert, key)
    assert kwargs == {
        "ssl_keyfile": str(key),
        "ssl_certfile": str(cert),
    }


def test_ssl_kwargs_spread_cleanly_into_a_call():
    # The intended use: `uvicorn.Config(app, **uvicorn_ssl_kwargs(...))`. A
    # dict with the wrong keys would fail this the same way a bad kwarg name
    # would fail the real call.
    def fake_config(**kwargs):
        return kwargs

    cert = Path("/tmp/server.crt")
    key = Path("/tmp/server.key")
    assert fake_config(**http_mode.uvicorn_ssl_kwargs(True, cert, key)) == {}
    assert fake_config(**http_mode.uvicorn_ssl_kwargs(False, cert, key)) == {
        "ssl_keyfile": str(key),
        "ssl_certfile": str(cert),
    }
