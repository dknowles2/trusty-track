"""Plain HTTP vs HTTPS: the one decision `TRUSTYTRACK_HTTP_ONLY` makes (#593).

HTTPS is the default for a reason: the camera capture
(`components/ui/CameraCapture.tsx`) and the check-in scanner's
`BarcodeDetector` only work in a *secure context*, and a browser only treats
`https://` and `localhost` that way — a plain `http://<lan-ip>` opened on a
second device (a check-in tablet, a laptop running the audience display) is
not secure, whatever the network it is on. So the server generates a
self-signed certificate and serves `https://` everywhere, which is what lets
those two features work at all off the machine running the server.

The certificate is the cost of that: every browser rejects it as untrusted,
and clicking past "Your connection is not private" on a wall-mounted display
or a borrowed tablet is a worse experience than the warning is buying for a
venue that has no camera work planned on a second device that evening.
`TRUSTYTRACK_HTTP_ONLY` is the escape hatch — read at call time, the same
shape `backend.demo_mode.enabled()` uses, so a test can set it without
restarting a process, and *off* by default, so an install that has never
heard of it serves exactly what it always has.

Kept as a tiny pure module, sibling to `run_server.py` rather than a few
lines inside it, for the reason `log_viewer.py` already is: importing
`run_server` runs its side effects — creating the platform data directory,
generating a TLS certificate, importing uvicorn and the whole backend — at
module scope, which is wrong for a unit test and unnecessary for exercising
one rule.
"""

from __future__ import annotations

from pathlib import Path

#: The environment variable. Any truthy value serves plain HTTP.
HTTP_ONLY_VARIABLE = "TRUSTYTRACK_HTTP_ONLY"

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def http_only_enabled(raw_value: str | None) -> bool:
    """Whether a raw environment-variable value asks for plain HTTP.

    Takes the value rather than reading `os.environ` itself — every real
    caller already has it from its own `os.environ.get(HTTP_ONLY_VARIABLE)`,
    the same split `demo_mode.enabled()` uses for `TRUSTYTRACK_DEMO_MODE` —
    and passing it in is what keeps this module free of any environment
    read of its own, so every value can be exercised with no `monkeypatch`.
    """
    return (raw_value or "").strip().lower() in _TRUTHY


def scheme(http_only: bool) -> str:
    """`"http"` or `"https"`, for building a URL."""
    return "http" if http_only else "https"


def needs_certificate(http_only: bool) -> bool:
    """Whether a TLS certificate should exist at all.

    A separate question from `uvicorn_ssl_kwargs` below: the certificate is
    generated once, well before the uvicorn config is built, so the caller
    deciding whether to run the (slow, first-run) generation step has no
    cert paths to hand back yet.
    """
    return not http_only


def uvicorn_ssl_kwargs(
    http_only: bool, cert_path: Path, key_path: Path
) -> dict[str, str]:
    """The `ssl_keyfile`/`ssl_certfile` kwargs for `uvicorn.Config`.

    Empty when `http_only` — passing `ssl_keyfile=None` to uvicorn is not the
    same as omitting the argument entirely, so the caller spreads this dict
    into `uvicorn.Config(...)` rather than conditionally setting two locals.
    """
    if http_only:
        return {}
    return {"ssl_keyfile": str(key_path), "ssl_certfile": str(cert_path)}
