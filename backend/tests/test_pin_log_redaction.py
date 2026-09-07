"""The operator PIN must never reach a server log line (#745).

The PIN travels as `?pin=...` on the WebSocket URL for both `/graphql`
subscriptions and `/ws/timer/{track_id}` — a browser cannot set headers on a
handshake, so this is deliberate (see `.claude/rules/auth-and-demo.md`). But
uvicorn's own connection log writes that whole URL to the `uvicorn.error`
logger on every accept, refusal and close — not `uvicorn.access`, which is
the trap a fix aimed at the "access log" by name alone would fall into.
Every launcher runs with uvicorn's default logging on (`scripts/serve.sh`,
the `Dockerfile`'s `CMD`, `packaging/run_server.py`, `scripts/pi-start.sh`),
so on a shared Pi that PIN lands in `journalctl`/`docker logs`/the desktop
app's own log file in plaintext on essentially every page load.

These tests exercise the real loggers uvicorn actually uses, with the real
message shape its protocol implementations log (see
`websockets/legacy/server.py`'s `WebSocketServerProtocol` and
`uvicorn/protocols/websockets/{websockets,wsproto}_impl.py`, both of which
log through `logging.getLogger("uvicorn.error")`, never `uvicorn.access`),
rather than spinning up a real server — the redaction has to happen at the
logging layer regardless of what wrote the record.
"""

import logging

from backend.api import main


def test_a_websocket_accept_line_does_not_carry_the_pin(caplog):
    """The exact shape `websockets_impl.py`/`wsproto_impl.py` logs on accept."""
    logger = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logger.info(
            '%s - "WebSocket %s" [accepted]',
            "127.0.0.1:65145",
            "/graphql?pin=9876",
        )

    assert "9876" not in caplog.text
    assert "pin=REDACTED" in caplog.text


def test_a_websocket_refusal_line_does_not_carry_the_pin(caplog):
    """The 403 shape logged when a handshake is refused mid-connect."""
    logger = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logger.info(
            '%s - "WebSocket %s" 403',
            "127.0.0.1:65145",
            "/ws/timer/1?pin=4242",
        )

    assert "4242" not in caplog.text
    assert "pin=REDACTED" in caplog.text


def test_other_query_parameters_survive_the_redaction(caplog):
    """Only the credential is stripped — a neighbouring, harmless parameter
    must still be readable, or the fix has thrown away more than it needed
    to."""
    logger = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logger.info(
            '%s - "WebSocket %s" [accepted]',
            "127.0.0.1:1",
            "/graphql?trackId=3&pin=1234&debug=1",
        )

    assert "1234" not in caplog.text
    assert "trackId=3" in caplog.text
    assert "debug=1" in caplog.text


def test_a_line_with_no_pin_is_untouched(caplog):
    """The filter must not rewrite ordinary log lines that mention nothing
    of the sort — a startup message, an unrelated URL."""
    logger = logging.getLogger("uvicorn.error")
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logger.info("Started server process [%d]", 12345)

    assert "Started server process [12345]" in caplog.text


def test_the_uvicorn_access_logger_is_covered_too(caplog):
    """Belt and braces (the same shape `domain.audit.redact` documents as
    "three defences, not a list"): if a future uvicorn release, a reverse
    proxy, or a format change ever put a full URL through the access
    logger instead, the credential must not survive that route either."""
    logger = logging.getLogger("uvicorn.access")
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        logger.info(
            '%s - "%s" %d',
            "127.0.0.1:1",
            "GET /graphql?pin=5555 HTTP/1.1",
            200,
        )

    assert "5555" not in caplog.text
    assert "pin=REDACTED" in caplog.text


def test_redact_pin_helper_handles_a_bare_query_string():
    """Unit-level pin on the pure helper itself, independent of logging."""
    assert main._redact_pin("/graphql?pin=abc123") == "/graphql?pin=REDACTED"


def test_redact_pin_helper_leaves_a_url_with_no_pin_alone():
    assert main._redact_pin("/graphql?trackId=3") == "/graphql?trackId=3"


def test_installing_the_filter_twice_does_not_duplicate_it():
    """`_install_pin_log_redaction` runs at import time; re-running it (a
    second `uvicorn.Config` in the same process, or the test suite
    reimporting this module) must stay a no-op rather than stacking a second
    copy of the filter and redacting twice — harmless here, but a sign
    something is being re-attached that should not be."""
    main._install_pin_log_redaction()
    main._install_pin_log_redaction()

    for name in ("uvicorn.access", "uvicorn.error"):
        matching = [
            f
            for f in logging.getLogger(name).filters
            if isinstance(f, main._PinRedactingFilter)
        ]
        assert len(matching) == 1
