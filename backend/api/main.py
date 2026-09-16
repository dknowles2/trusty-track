"""
FastAPI application entry point.

Mounts the GraphQL router and static file serving.
"""

import base64
import io
import logging
import os
import re
import sys
import urllib.parse
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path

import pillow_heif
from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask
from strawberry.fastapi import GraphQLRouter

from backend import demo_content, demo_mode
from backend.api import auth
from backend.api.loaders import RequestLoaders
from backend.api.pubsub import pubsub
from backend.api.schema import MAX_UPLOAD_BYTES, _publish_races_list, schema
from backend.db import crud, models
from backend.db.database import (
    DATA_DIR,
    UPLOAD_DIR,
    SessionLocal,
    database_path,
    engine,
    init_db,
    known_revisions,
)
from backend.domain import audit
from backend.domain import replays as domain_replays
from backend.services import backup, discovery, network, printables
from backend.services import displays as displays_service
from backend.services import replays as replays_service
from backend.services.image_processing import (
    UnreadableImageError,
    convert_to_browser_safe_png,
)
from backend.services.timer import devices
from backend.services.timer.manager import TimerManager, initialize_timer_managers
from backend.services.timer.proxy import ProxySession, WebSocketTransport

# Load environment variables from .env if present
load_dotenv()

# Register the HEIF/HEIC plugin so Pillow can open those files.
pillow_heif.register_heif_opener()

# Registry of TimerManager instances, keyed by track_id
TIMER_MANAGERS: dict[int, TimerManager] = {}

# The WebSocket and ProxySession currently "owning" a track's proxy timer. On
# a proxied track this socket *is* the timer, so a second connection to the
# same track_id — a second device, or a reload whose old socket has not gone
# away yet — is a second timer for the same device. Left alone that used to
# repoint `manager.set_write_fn()` and leave both sessions running: the first
# tab kept believing it was armed while its bytes went nowhere (#301).
#
# A takeover tears the outgoing session down itself — `ProxySession.close()`,
# which resets the write function and tells the manager the connection is
# down — *before* installing the new one, and removes the registry entry
# first so the outgoing connection's own `finally` does not repeat that
# teardown once its receive loop eventually notices the close. Two calls to
# `handle_disconnect()` would reset the *new* connection's write function
# back to the no-op, which is the bug this exists to close. The outgoing
# socket is also closed with an explicit code and reason, so the tab that
# lost the timer says so — but that is only for the person watching the
# screen; the manager's state is already settled by the time it happens.
TIMER_WS_CONNECTIONS: dict[int, tuple[WebSocket, ProxySession]] = {}

# The mDNS registration for this process, if any (#723) — `None` whenever
# `discovery.start()` declined (demo mode, `TRUSTYTRACK_MDNS=off`, avahi
# already answering, no LAN address, or a saturated namespace), the same
# "nothing claims a name it does not hold" rule `MdnsResponder` itself
# follows. Module-level, the same shape as `TIMER_MANAGERS`, so the shutdown
# half of the lifespan below can find what to unregister.
MDNS_RESPONDER: discovery.MdnsResponder | None = None

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


#: Matches the operator PIN's one crossing of a URL — `?pin=...` or
#: `&pin=...`, however it is capitalised — and nothing else in the query
#: string around it. See `_redact_pin` for why this exists.
_PIN_QUERY_PARAM = re.compile(r"([?&])pin=[^&\s\"]*", re.IGNORECASE)


def _redact_pin(value: str) -> str:
    """Replace a `pin=` query-string value with a placeholder, wherever it
    appears in *value*.

    The PIN travels in the `x-trustytrack-pin` header for an ordinary HTTP
    request, but a WebSocket handshake has no headers a browser can set
    (`api/auth.py`), so `/graphql` subscriptions and `/ws/timer/{track_id}`
    both carry it as `?pin=...` instead — the one place this credential ever
    crosses a URL. uvicorn's own connection logging writes that whole URL to
    a logger on every accept, refusal and close (#745), which is what this
    exists to stop reaching a handler.

    Matched on the query string's own `pin=`, the way `domain.audit.redact`
    matches a JSON key — except there is exactly one shape this ever takes,
    fixed by `frontend/src/api/pin.ts`'s `withPin`, and it is not a name a
    caller chooses, so a literal match is the whole rule.
    """
    return _PIN_QUERY_PARAM.sub(r"\1pin=REDACTED", value)


class _PinRedactingFilter(logging.Filter):
    """A `logging.Filter` that runs `_redact_pin` over every string a log
    record carries, wherever that string lives.

    A record's message can arrive pre-formatted (`record.msg` already a
    plain string) or as a format string plus `record.args` — uvicorn uses
    the second shape for its own connection log
    (`'%s - "WebSocket %s" [accepted]'`, with the path-and-query as one of
    the args) — so both are checked rather than only the one a single
    example happens to use.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and "pin=" in record.msg.lower():
            record.msg = _redact_pin(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(
                _redact_pin(arg)
                if isinstance(arg, str) and "pin=" in arg.lower()
                else arg
                for arg in record.args
            )
        elif isinstance(record.args, dict):
            record.args = {
                key: (
                    _redact_pin(value)
                    if isinstance(value, str) and "pin=" in value.lower()
                    else value
                )
                for key, value in record.args.items()
            }
        return True


def _install_pin_log_redaction() -> None:
    """Attach `_PinRedactingFilter` to uvicorn's own loggers, once each.

    **Both `uvicorn.access` and `uvicorn.error` get it, and the second one is
    the one that matters.** The WebSocket "accepted"/refused/closed line
    (`uvicorn/protocols/websockets/websockets_impl.py` and its `wsproto`
    twin) logs through `logging.getLogger("uvicorn.error")`, not
    `uvicorn.access` — `uvicorn.access` is only the ordinary HTTP request
    line, which never carries the PIN because that travels in a header for
    an ordinary request. A fix aimed at "the access log" by name alone would
    miss the one line #745 is actually about; `uvicorn.access` is covered
    too as a second defence, the same "three defences, not a list" shape
    `domain.audit.redact`'s own docstring describes, in case a future
    change, a reverse proxy, or a format change ever puts a full URL through
    it instead.

    **Attached to the logger, not to a handler.** uvicorn configures its own
    handlers via `logging.config.dictConfig` — for the CLI entry point
    (`uvicorn backend.api.main:app`), that runs in `Config.__init__`,
    *before* this module is even imported, since `self.app` is still a
    string at that point and only gets resolved to this module in
    `Config.load()`. A filter added to a handler that `dictConfig` can later
    replace would be silently dropped; a logger's own filters are untouched
    by `dictConfig` unless the config explicitly names a `filters` key for
    that logger, which uvicorn's own `LOGGING_CONFIG` does not. So this
    survives however the server is started — the CLI form re-imports this
    module (and so re-runs this function) after `configure_logging()` has
    already built the handlers; the desktop launcher's `packaging/
    run_server.py` imports this module first and only later constructs its
    own `uvicorn.Config(_app, ...)`, whose `configure_logging()` runs after
    this filter is already attached. Order does not matter either way.

    Idempotent, checked by identity of the filter *type* rather than by
    tracking whether this ran: reimporting this module (the test suite,
    a second `uvicorn.Config` in the same process) must not stack a second
    copy of the filter on top of the first.
    """
    for name in ("uvicorn.access", "uvicorn.error"):
        target_logger = logging.getLogger(name)
        already_installed = any(
            isinstance(existing, _PinRedactingFilter)
            for existing in target_logger.filters
        )
        if not already_installed:
            target_logger.addFilter(_PinRedactingFilter())


_install_pin_log_redaction()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    Handle application lifespan events.
    Ensures the database is initialized before the app starts serving requests.
    """
    logger.info("Initializing database...")
    try:
        init_db()
        logger.info("Database initialization complete.")
    except Exception as e:
        # An operator can read the log and the app is still there, which is why
        # this has always carried on. The demo has nobody to read it: its
        # storage is ephemeral, so a failure here means serving an empty or
        # half-migrated database to every visitor with nothing to say so.
        if demo_mode.enabled():
            raise
        logger.error(f"Failed to initialize database: {e}")
        # In a real production app, you might want to exit here

    # The demo builds its own event on first boot (see `backend/demo_content`).
    # Idempotent, because the flag says nothing about whether this container has
    # run before — an always-on host restarts with its data still there.
    if demo_mode.enabled():
        # `try`/`finally` rather than `with`: the suite substitutes a session
        # factory that delegates by `__getattr__` (conftest's
        # `timer_session_factory`), and `with` looks dunders up on the type, so
        # a context manager here is unusable from every test that reaches it.
        session = SessionLocal()
        try:
            if demo_content.is_seeded(session):
                logger.info("The demo is already seeded; leaving it alone.")
            else:
                race = demo_content.seed(session)
                logger.info("Seeded the demo with race %d (%s).", race.id, race.name)
        finally:
            session.close()

    # Trim the audit log (#219). At startup rather than per write: counting and
    # deleting on every mutation would put two statements in the path of every
    # heat result, and the table being briefly over its cap between restarts
    # costs nothing.
    try:
        with SessionLocal() as session:
            removed = crud.prune_audit_log(session)
        if removed:
            logger.info("Pruned %d old audit entries.", removed)
    except Exception as e:
        logger.error("Could not prune the audit log: %s", e)

    # Stage 1's retention is delete-after-next-heat, held only in this
    # process's memory (`services/replays.py`'s own docstring) — a clip from
    # before a restart has no index entry pointing at it and nothing left
    # that would ever clean it up otherwise, so the directory is emptied
    # rather than merely forgotten.
    try:
        replays_service.store.sweep()
    except Exception as e:
        logger.error("Could not sweep the replay clip directory: %s", e)

    logger.info("Initializing timer managers...")
    try:
        await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)
        logger.info("Timer managers ready: %s", list(TIMER_MANAGERS.keys()))
    except Exception as e:
        logger.error(f"Failed to initialize timer managers: {e}")

    # Advertise this machine over mDNS (#723, stages 1-2) so a display or a
    # check-in tablet can open `http://trustytrack.local:8000` instead of an
    # IP address. `discovery.start()` already declines on its own — demo
    # mode, `TRUSTYTRACK_MDNS=off`, avahi already answering, no LAN address —
    # so the `try` here is only for the unexpected: a caller has no business
    # taking the whole app down over a feature whose whole fallback is "show
    # an IP instead", which is exactly what happens if this leaves
    # `MDNS_RESPONDER` at `None`. `configured`/`version` are stage 2's
    # `_trustytrack._tcp` payload; a failure reading either falls back to
    # "not yet" and "unknown" rather than skipping registration outright.
    global MDNS_RESPONDER
    logger.info("Advertising this machine over mDNS...")
    try:
        try:
            with SessionLocal() as session:
                configured = session.query(models.Organization).first() is not None
        except Exception:
            configured = False
        try:
            from backend.version import __version__ as app_version
        except ImportError:
            app_version = "unknown"
        MDNS_RESPONDER = discovery.start(configured=configured, version=app_version)
        if MDNS_RESPONDER:
            logger.info("Reachable at %s", MDNS_RESPONDER.hostname)
        else:
            logger.info("Not advertising over mDNS; falling back to IP addresses.")
    except Exception as e:
        logger.error("Could not start mDNS advertising: %s", e)

    yield

    if MDNS_RESPONDER:
        MDNS_RESPONDER.stop()
        MDNS_RESPONDER = None


app = FastAPI(lifespan=lifespan)


def allowed_origins() -> list[str]:
    """Origins the browser may call this server from.

    The wildcard default is the LAN install and is explained below. A public
    deployment sets ``TRUSTYTRACK_ALLOWED_ORIGINS`` to its own hostname: there
    the reasoning does not hold, because ``VIEWER`` is the no-credential
    default and a viewer can read a roster — every racer's name, and their
    photograph.

    A function so it can be tested. The value is read once at import because
    that is when the middleware is built; a caller changing the environment
    afterwards changes nothing, and pretending otherwise would be worse than
    not offering it.

    An empty or all-whitespace setting falls back to the wildcard rather than
    to an empty list. An empty list refuses *every* cross-origin request, which
    on a LAN install is indistinguishable from the app being broken — and the
    likeliest way to arrive at one is a deployment setting the variable to an
    empty string, which means "I did not configure this", not "refuse
    everybody".
    """
    configured = os.getenv("TRUSTYTRACK_ALLOWED_ORIGINS", "*")
    origins = [origin.strip() for origin in configured.split(",") if origin.strip()]
    return origins or ["*"]


ALLOWED_ORIGINS = allowed_origins()

app.add_middleware(
    CORSMiddleware,
    # `allow_origins=["*"]` with `allow_credentials=True` is rejected outright
    # by browsers — the wildcard is not permitted on a credentialed request — so
    # the old pairing was broken *and* permissive (#15). Nothing here uses
    # cookies: the operator PIN travels in a header on a same-origin request, so
    # credentials are off and the wildcard is honest. A display or a phone on
    # the venue wifi loads the served page from this origin; a wildcard here
    # does not widen what they can do, because the PIN is what the server checks.
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


#: The largest body this app accepts on `/graphql` (and its `/api/graphql`
#: twin).
#:
#: GraphQL carries every mutation argument inside one JSON body, and two of
#: them had no cap of their own (#744): `uploadImage`'s `data_url`
#: (`schema.py`) is `base64.b64decode`d with no length check, and
#: `importRacers`'s `csv_data` goes straight into `csv.DictReader`, unlike
#: `POST /upload/`'s `MAX_UPLOAD_BYTES` above and the GPRM/DerbyNet
#: importers' `MAX_GPRM_IMPORT_BYTES` (`schema.py`), which already measure
#: while reading rather than after. Both of those resolvers live in
#: `schema.py`, so a per-argument check there is somebody else's fix to
#: make; this is the cap that can be applied at the one seam that already
#: covers every GraphQL mutation regardless of which argument is carrying
#: the oversized value — the HTTP request body itself, before Strawberry
#: ever parses it.
#:
#: Sized above the largest body a *legitimate* request can already produce:
#: a GPRM/DerbyNet import's own `file_data` is a base64 data URL of up to
#: `MAX_GPRM_IMPORT_BYTES` (64 MB) decoded, which is itself about 85 MB on
#: the wire. This leaves headroom above that rather than trimming it — the
#: point is bounding an unbounded body, not tightening an existing one.
MAX_GRAPHQL_BODY_BYTES = 128 * 1024 * 1024

#: Path prefixes this cap applies to — both mount points `/graphql` is
#: registered under (see `app.include_router` below), for the same reason
#: the printables and timer-test routes are each registered twice.
_GRAPHQL_PATH_PREFIXES = ("/graphql", "/api/graphql")


class MaxGraphQLBodySizeMiddleware:
    """A pure-ASGI middleware capping the body of a request to `/graphql`.

    Not `starlette.middleware.base.BaseHTTPMiddleware`: that class reads the
    whole body into memory via `request.body()` before a handler ever sees
    it, which is exactly the thing being guarded against. This instead reads
    the body off the raw ASGI `receive` channel one message at a time,
    totalling as it goes and refusing the moment the running total clears
    the cap — the same "measure while reading, not after" rule
    `_read_capped` follows for `POST /upload/` below, applied at the
    transport boundary because the two resolvers that need it
    (`uploadImage`, `importRacers`) live in a file this fix does not touch.

    Every message read while measuring is buffered and replayed to the
    wrapped app afterwards through a synthetic `receive`, so a request that
    clears the cap reaches Strawberry exactly as it would have with no
    middleware in front of it at all — this only ever adds a rejection, never
    changes what a request under the cap looks like once it arrives.
    """

    def __init__(self, app):  # type: ignore[no-untyped-def]
        self.app = app

    async def __call__(self, scope, receive, send):  # type: ignore[no-untyped-def]
        if scope["type"] != "http" or not any(
            scope["path"].startswith(prefix) for prefix in _GRAPHQL_PATH_PREFIXES
        ):
            await self.app(scope, receive, send)
            return

        buffered: list[dict] = []
        total = 0
        while True:
            message = await receive()
            buffered.append(message)
            if message["type"] != "http.request":
                # A disconnect (or anything else unexpected) arriving before
                # the body finished — nothing left to measure, so stop and
                # let the buffered replay below hand it straight through.
                break
            total += len(message.get("body", b""))
            # Read fresh from the module on every request, not captured at
            # `__init__` time, so a caller (a test) can change the cap after
            # the middleware is already built into the app.
            if total > MAX_GRAPHQL_BODY_BYTES:
                response = JSONResponse(
                    {
                        "detail": (
                            "That request is larger than "
                            f"{MAX_GRAPHQL_BODY_BYTES // (1024 * 1024)} MB."
                        )
                    },
                    status_code=413,
                )
                await response(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        async def _replay_receive():
            if buffered:
                return buffered.pop(0)
            return await receive()  # pragma: no cover - body already exhausted

        await self.app(scope, _replay_receive, send)


app.add_middleware(MaxGraphQLBodySizeMiddleware)


# Dependency
def get_db():
    """Yield a database session and ensure it's closed after use."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle
    _BASE_DIR = Path(sys._MEIPASS)  # type: ignore[attr-defined]
else:
    # Development mode: Path(__file__) is backend/api/main.py
    _BASE_DIR = Path(__file__).parent.parent.parent

FRONTEND_DIST = _BASE_DIR / "frontend" / "dist"

# Mount static files
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")


def _role_for_request(db: Session, pin: str | None) -> auth.Role:
    """The caller's role, from the PIN they sent and the PINs that are set.

    Reads the single `Organization` rather than taking a race — roles are
    install-wide, and an install has one organization. No organization yet
    (the first run, before the wizard has saved) means nothing is configured,
    so `role_for` returns operator.
    """
    organization = db.query(models.Organization).first()
    return auth.role_for(
        pin,
        operator_pin_hash=getattr(organization, "operator_pin_hash", None),
        checkin_pin_hash=getattr(organization, "checkin_pin_hash", None),
    )


async def get_graphql_context(
    request: Request = None,  # type: ignore[assignment]
    websocket: WebSocket = None,  # type: ignore[assignment]
    db: Session = Depends(get_db),
) -> dict:
    """Provide the database session, timer managers, loaders and the role.

    Strawberry hands this a `Request` for HTTP and a `WebSocket` for
    subscriptions, never both — so the PIN is read from whichever arrived. The
    socket carries it as a query parameter because `graphql-ws` has no headers
    of its own; the browser cannot set them on a WebSocket handshake.
    """
    if request is not None:
        pin = request.headers.get(auth.PIN_HEADER)
    elif websocket is not None:
        pin = websocket.query_params.get("pin")
    else:  # pragma: no cover - Strawberry always supplies one
        pin = None

    # Where the request came from, for the audit log (#219). Read here because
    # this is the only place that still holds the `Request`; by the time a
    # resolver runs there is nothing left to ask. `client` is None behind some
    # proxies and in the test client, and null is the honest answer then rather
    # than a placeholder that looks like an address.
    source_ip = None
    if request is not None and request.client is not None:
        source_ip = request.client.host
    elif websocket is not None and websocket.client is not None:
        source_ip = websocket.client.host

    return {
        "db": db,
        "source_ip": source_ip,
        # A callable, not a value: see `auth.resolve_role`. Only a mutation
        # asks, and working it out costs a query.
        "role_resolver": lambda: _role_for_request(db, pin),
        "timer_managers": TIMER_MANAGERS,
        # The `.local` name this process is actually advertising (#723,
        # stage 3), if any — read fresh off the module global on every
        # request/subscription rather than captured once, since the lifespan
        # sets it after this function is first defined but before any real
        # request can arrive.
        "mdns_hostname": MDNS_RESPONDER.hostname if MDNS_RESPONDER else None,
        "loaders": RequestLoaders(db),
        # Managers created mid-request (e.g. by createTrack) need a factory for
        # their own background writes; tests override this.
        "session_factory": SessionLocal,
    }


graphql_app = GraphQLRouter(schema, context_getter=get_graphql_context)
app.include_router(graphql_app, prefix="/graphql")
# In production the built frontend sends requests to /api/graphql (the Vite dev
# proxy rewrites /api/* → /* so /graphql above handles dev; this covers production).
app.include_router(graphql_app, prefix="/api/graphql")


@app.get("/health")
async def health() -> dict:
    """Return application health status."""
    try:
        from ..version import __version__ as _version
    except ImportError:
        _version = "unknown"
    return {"status": "ok", "version": _version}


# Both paths, for the same reason `/graphql` is mounted twice: the built
# frontend asks for `/api/printables/...`, and the Vite dev proxy strips the
# `/api` before forwarding. Registering only the `/api` form makes the print
# page work in production and 404 in development, which is where it is written.
@app.get("/printables/barcode/{racer_id}.png")
@app.get("/api/printables/barcode/{racer_id}.png")
def check_in_barcode(racer_id: int, db: Session = Depends(get_db)) -> Response:
    """The QR code that takes a check-in operator straight to this racer.

    REST rather than GraphQL because the response is an image — the print page
    puts it in an `<img src>` and the browser handles the rest, including
    caching sixty of them while a sheet renders.

    The rest of a printable — the pit pass, the licence, the sheet they sit on —
    is HTML the browser prints. A QR code is the one part a page cannot draw
    without another dependency, so it is the only part that comes from here.
    """
    racer = db.query(models.Racer).filter(models.Racer.id == racer_id).first()
    if racer is None:
        raise HTTPException(status_code=404, detail="Racer not found")

    return Response(
        content=printables.check_in_png(racer.race_id, racer.id),
        media_type="image/png",
        # The payload is derived from two ids that cannot change for a racer, so
        # the image is immutable. Worth saying: a roster sheet is sixty of these
        # and the operator will reprint it more than once.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


#: Every page this endpoint is willing to render a QR code for, keyed by the
#: fragment of the URL that identifies it. Widened for #614's full-screen
#: `QRCODE` display view, which points at the same audience observation page
#: spectators already reach from a phone, alongside #414's original ballot.
#: This route stays a *scoped* renderer rather than a general-purpose one —
#: `race_id` is still checked against the URL below — so the set is closed
#: rather than "anything containing `/race/{race_id}/`": a display holds no
#: PIN (#15), and the point of checking at all is that this is not a way to
#: point a kiosk at an arbitrary address.
_QR_ALLOWED_PATHS = ("/vote", "/observation")


def _validate_vote_qr_url(url: str, race_id: int, request: Request) -> None:
    """Validate that `url` points to an audience-facing page on this Trusty
    Track instance.

    Rejects non-HTTP(S) schemes, paths outside the allowed vote and
    observation endpoints for this race, and hostnames/ports that do not
    belong to this server instance (#866).
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid URL") from exc

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="Invalid URL scheme: must be http or https",
        )

    clean_path = parsed.path.rstrip("/")
    expected_paths = tuple(f"/race/{race_id}{path}" for path in _QR_ALLOWED_PATHS)
    if not any(clean_path == p or clean_path.endswith(p) for p in expected_paths):
        raise HTTPException(
            status_code=400,
            detail="Not an audience-facing address for this race",
        )

    target_host = (parsed.hostname or "").lower().strip("[]")
    if not target_host:
        raise HTTPException(
            status_code=400,
            detail="URL must specify a valid host",
        )

    allowed_hosts: set[str] = {"localhost", "127.0.0.1", "::1"}
    allowed_hosts.update(addr.lower().strip("[]") for addr in network.lan_addresses())

    if MDNS_RESPONDER is not None and MDNS_RESPONDER.hostname:
        allowed_hosts.add(MDNS_RESPONDER.hostname.lower())
    allowed_hosts.add(f"{discovery.HOSTNAME}.local".lower())
    allowed_hosts.add(discovery.HOSTNAME.lower())

    if request.url.hostname:
        allowed_hosts.add(request.url.hostname.lower().strip("[]"))

    if target_host not in allowed_hosts:
        raise HTTPException(
            status_code=400,
            detail=f"URL host '{target_host}' is not this server instance",
        )

    if parsed.port is not None:
        allowed_ports: set[int] = {80, 443, discovery._candidate_port()}
        if request.url.port is not None:
            allowed_ports.add(request.url.port)

        # `request.url.port` is the port *this process* answered the HTTP
        # request on — right for a single-process production install, wrong
        # under the Vite dev proxy (and the e2e/docs-screenshot run that
        # inherits it): the browser fetches this image from the page's own
        # origin, `changeOrigin` rewrites the Host header the backend sees,
        # and `shareAddress.ts` built `url` from `window.location.port`, the
        # port the *page* loaded on, not the one the proxied request
        # arrives with (#944). For an ordinary same-origin `<img>` fetch a
        # real browser sets `Referer` (and sometimes `Origin`) to the page's
        # own address, which is exactly that port — so a request carrying
        # one is worth widening the allowed *port* set for. A raw HTTP
        # client can of course forge either header, so this is not treated
        # as proof of anything beyond that: the port it names is only ever
        # trusted for a *host* this request has already been checked against
        # (`allowed_hosts`, computed above from this server's own addresses)
        # — never against `parsed`'s own host — so forging the header can
        # widen which port on this instance is accepted, never which host.
        # That is exactly the guarantee #866/#922 added the host check for.
        for header_name in ("referer", "origin"):
            header_value = request.headers.get(header_name)
            if not header_value:
                continue
            try:
                header_parsed = urllib.parse.urlparse(header_value)
            except Exception:
                continue
            header_host = (header_parsed.hostname or "").lower().strip("[]")
            if header_host in allowed_hosts and header_parsed.port is not None:
                allowed_ports.add(header_parsed.port)

        if parsed.port not in allowed_ports:
            raise HTTPException(
                status_code=400,
                detail=f"URL port {parsed.port} does not match this server instance",
            )


@app.get("/printables/vote-qr/{race_id}.png")
@app.get("/api/printables/vote-qr/{race_id}.png")
def voting_qr(
    race_id: int,
    url: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    """A QR code a phone can scan to reach this race, on the ballot or the
    audience display (#414, #614).

    Named for the feature it shipped with first; it now backs both the
    Awards page's ballot QR code and the full-screen `QRCODE` display view,
    which is why the guard below checks a *set* of paths rather than one.
    Renaming the route was considered and skipped — nothing about the path
    is client-visible API surface worth documenting twice, and the two
    existing callers (and their tests) would have needed nothing but churn.

    `url` is supplied by the caller rather than built here: the frontend
    already works out the one address a phone can actually reach —
    substituting a LAN address for `localhost` when the browser's own origin
    would not do — and encoding a second copy of that logic here would be
    two ways of getting a share address disagreeing with each other. Scoped
    to `race_id` only to reject a code for an obviously unrelated URL; this
    is not a general-purpose QR generator.

    Not cached `immutable` like the check-in code above: the address depends
    on the machine's current network, which can change between requests in a
    way a racer's id never does.
    """
    race = db.query(models.Race).filter(models.Race.id == race_id).first()
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    _validate_vote_qr_url(url=url, race_id=race_id, request=request)

    return Response(
        content=printables.url_png(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


def _refuse_on_demo(what: str) -> None:
    """Refuse a REST route the public demo does not offer.

    ``RolePolicyExtension`` and ``DemoPolicyExtension`` guard GraphQL mutations
    and these routes are not GraphQL, so each makes its own check — the same
    reason the backup endpoints and the timer socket call
    :func:`_require_operator` for themselves (#15).
    """
    if demo_mode.enabled():
        raise HTTPException(status_code=403, detail=f"{what} is disabled on the demo")


def _require_checkin(request: Request, db: Session) -> None:
    """Refuse a caller who is not at least the registration desk.

    Weaker than :func:`_require_operator` on purpose: this guards the upload
    route, whose GraphQL twin ``uploadImage`` is classified as a ``CHECKIN``
    mutation. Requiring the operator here would be stricter than the mutation
    that does the same thing, and the desk is exactly who photographs a car.
    """
    if _role_for_request(db, request.headers.get(auth.PIN_HEADER)) is auth.Role.VIEWER:
        raise HTTPException(status_code=403, detail="Check-in PIN required")


def _require_operator(request: Request, db: Session) -> None:
    """Refuse anyone but the operator, for a route the role policy cannot see.

    `RolePolicyExtension` guards GraphQL mutations and these are not GraphQL, so
    the check is made here for the same reason the timer socket makes its own
    (#15). Backup is operator-only in both directions: the archive holds every
    racer's name and photograph, and a restore replaces the running event.
    """
    if _role_for_request(db, request.headers.get(auth.PIN_HEADER)) is not (
        auth.Role.OPERATOR
    ):
        raise HTTPException(status_code=403, detail="Operator PIN required")


def _staging_dir() -> Path:
    """Scratch space beside the data it is staging.

    Inside the data directory rather than the system temp directory so that
    `os.replace` is a rename rather than a copy across filesystems — on a Pi the
    two are usually different devices, and a cross-device restore would copy the
    database twice and lose the atomicity the rename gives.
    """
    return Path(DATA_DIR) / ".backup-staging"


# Both paths, as with the printables barcode above: the built frontend asks for
# `/api/...` and the Vite dev proxy strips the prefix before forwarding.
@app.get("/backup")
@app.get("/api/backup")
def download_backup(request: Request, db: Session = Depends(get_db)) -> FileResponse:
    """The whole event as one file: the database and every photograph.

    REST rather than GraphQL because the response is a zip. Streamed from a
    temporary file rather than built in memory — an archive is a database plus
    sixty photographs, and the machine this runs on has a gigabyte of RAM.
    """
    # Zip-the-world on demand, behind no credential on a demo where nobody sets
    # a PIN: CPU and disk amplification, for an archive of invented data.
    _refuse_on_demo("Downloading a backup")
    _require_operator(request, db)

    path = database_path()
    if path is None:
        raise HTTPException(
            status_code=503,
            detail="This install does not store its data in a file, so it "
            "cannot be backed up here.",
        )

    try:
        from ..version import __version__ as app_version
    except ImportError:  # pragma: no cover - version is generated at build time
        app_version = "unknown"

    staging = _staging_dir()
    staging.mkdir(parents=True, exist_ok=True)
    archive_path = staging / f"trusty-track-backup-{uuid.uuid4().hex}.zip"

    manifest = backup.write_archive(
        archive_path,
        engine=engine,
        upload_dir=Path(UPLOAD_DIR),
        app_version=app_version,
        staging_dir=staging,
    )

    # An archive holds every racer's name and photograph, so leaving the
    # building is worth a line (#219).
    crud.record_audit(
        db,
        "backupDownloaded",
        role=audit.ActorRole.OPERATOR.value,
        source_ip=request.client.host if request.client else None,
        details={"uploadCount": manifest.upload_count},
    )

    stamp = manifest.created_at.replace(":", "").replace("-", "")[:15]
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=f"trusty-track-backup-{stamp}.zip",
        # The archive exists only to be sent. Deleting it after the response
        # keeps a series of backups from filling the card they protect.
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


@app.post("/backup/restore")
@app.post("/api/backup/restore")
async def restore_backup(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Replace the running event with the contents of an archive.

    Destructive and deliberately so — the confirmation belongs to the client,
    which is the only place that can ask a person. What this owes them is that a
    refusal costs nothing: `restore_archive` validates the manifest, checks the
    schema version and unpacks every member before it moves anything, so a
    damaged or too-new archive leaves the event exactly as it was.

    The database that was replaced is kept beside the new one with a
    `.pre-restore` suffix, and the uploads directory likewise.
    """
    # Replaces every racer and result from an anonymous upload. The demo resets
    # itself; it does not take a new instance from a visitor.
    _refuse_on_demo("Restoring a backup")
    _require_operator(request, db)

    path = database_path()
    if path is None:
        raise HTTPException(
            status_code=503,
            detail="This install does not store its data in a file, so it "
            "cannot be restored here.",
        )

    # The request's own session holds a connection to the database that is about
    # to be replaced. Close it before the swap rather than after.
    db.close()

    # Timer managers hold serial ports and write through their own sessions
    # (#9), and the track ids they are keyed on are about to change. Stop them
    # before the swap; they are rebuilt from the restored tracks below.
    for manager in list(TIMER_MANAGERS.values()):
        try:
            await manager.stop()
        except Exception as exc:  # pragma: no cover - best effort teardown
            logger.warning("Timer manager did not stop cleanly: %s", exc)
    TIMER_MANAGERS.clear()

    try:
        manifest = backup.restore_archive(
            file.file,
            database_path=path,
            upload_dir=Path(UPLOAD_DIR),
            staging_dir=_staging_dir(),
            known_revisions=known_revisions(),
            dispose=engine.dispose,
        )
    except backup.ArchiveError as exc:
        # Nothing was moved, so the event is untouched — but the managers were
        # stopped, so put them back before reporting the refusal.
        await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # An older archive is restored as it was and then upgraded, which is the
    # same path a pre-Alembic database already takes at startup.
    init_db()
    await initialize_timer_managers(TIMER_MANAGERS, session_factory=SessionLocal)

    # Every heat id and `recorded_at` a stored clip was keyed against just
    # stopped meaning anything — the restored database has its own heats,
    # not these. Stage 1 keeps no clip across a restart already (see the
    # lifespan's own sweep); a restore replaces the running event exactly
    # the same way (#177 stage 1a).
    replays_service.store.sweep()

    # Every race in the room just changed underneath whoever is looking at
    # one — a wall display, the check-in tablet, a second operator tab. The
    # same signal `createRace`/`updateRace`/`deleteRace`/`createPracticeRace`
    # already publish (#300), for the same reason: without it, a normalized
    # cache elsewhere keeps rendering the replaced event with nothing telling
    # it to refetch, and a restore replacing every race at once is the
    # strongest case there is for sending it (#888).
    await _publish_races_list()

    # Recorded *after* the swap and through a new session, which is the whole
    # subtlety here: the request's own session was closed and its database has
    # been moved aside, so an entry written any earlier would be filed in the
    # copy nobody will ever open again. This one belongs in the database that
    # now exists, where somebody looking for "why is this not my event" will
    # actually find it.
    try:
        with SessionLocal() as session:
            crud.record_audit(
                session,
                "backupRestored",
                role=audit.ActorRole.OPERATOR.value,
                source_ip=request.client.host if request.client else None,
                details={
                    "createdAt": manifest.created_at,
                    "appVersion": manifest.app_version,
                    "uploadCount": manifest.upload_count,
                },
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Could not record the restore in the audit log: %s", exc)

    return {
        "restored": True,
        "created_at": manifest.created_at,
        "app_version": manifest.app_version,
        "upload_count": manifest.upload_count,
    }


# Both paths, as with the backup endpoints above: the built frontend asks for
# `/api/...` and the Vite dev proxy strips the prefix before forwarding.
@app.get("/timer-test/{track_id}/report")
@app.get("/api/timer-test/{track_id}/report")
def timer_test_report(
    track_id: int, request: Request, db: Session = Depends(get_db)
) -> JSONResponse:
    """The timer test report, as a file the operator can attach to an issue (#235).

    One JSON document carrying everything a profile fix needs: the app
    version, which profile matched and its provenance, the port framing, and
    the whole timestamped serial conversation — the same kind of evidence as
    the recordings in ``backend/tests/timer_recordings/``, which is what lets
    a good report become a regression fixture.

    REST rather than GraphQL because the answer is a download. Operator-only
    and self-guarding, like the backup endpoints: the role policy covers
    mutations, and this is neither.
    """
    _require_operator(request, db)

    mgr = TIMER_MANAGERS.get(track_id)
    if mgr is None:
        raise HTTPException(status_code=404, detail="No timer for that track")
    track = crud.get_track(db, track_id)

    try:
        from ..version import __version__ as app_version
    except ImportError:  # pragma: no cover - version is generated at build time
        app_version = "unknown"

    report = {
        "app_version": app_version,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "track": {
            "id": track_id,
            "name": track.name if track else None,
            "lane_count": track.lane_count if track else None,
            "timer_type": track.timer_type.value if track else None,
        },
        **mgr.test_report(),
    }
    filename = f"trusty-track-timer-report-track-{track_id}.json"
    return JSONResponse(
        report,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/replay/")
async def upload_replay_clip(
    race_id: int = Form(...),
    heat_id: int = Form(...),
    recorded_at: str = Form(...),
    camera_id: str = Form(...),
    t0_offset_ms: int = Form(0),
    duration_ms: int = Form(0),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Store one camera's replay clip for one heat (#177 stage 1a).

    **No PIN required — the same auth story `displayAssignment`'s
    subscription already has.** A camera is a display with a role
    (`domain.displays.DisplayRole.CAMERA`), and a display holds no credential
    (#15); requiring one here would make the camera page need something the
    displays it sits beside never have. What actually guards this route is
    narrower than a PIN but real: a caller has to already know a specific
    heat's *current* `recordedAt` — a value that only exists once that heat's
    result has just been recorded, and that changes the moment it is re-run —
    which is not a fact a drive-by request can supply. **Refused outright on
    the demo** (`_refuse_on_demo`), the same as `POST /upload/`: it writes an
    unauthenticated caller-supplied file to disk, and the demo exists partly
    to avoid that.

    **`recorded_at` is the clip's key, and a stale one is refused with 409.**
    It must equal the heat's *current* `Heat.recorded_at` — the exact string
    `heatSession` published at the moment the camera captured its buffer
    (the same pair `frontend/src/features/observation/resultsOverlay.ts`'s
    `observeHeatResult` already keys a result by). A heat re-run between
    capture and upload (Reset Heat, a corrected result) moves `recorded_at`
    on, and the clip is for a run the record no longer holds — refusing it
    is right, not merely convenient: playing it back would show the wrong
    result.

    **Never `uploads/`.** The file lands under `DATA_DIR/replays/`, given a
    fresh, non-enumerable name — `services/backup.py` archives `uploads/` by
    name, and a clip landing there would be swept into every backup, which
    is exactly what stage 1's retention story says must not happen. Content
    type is checked against `ALLOWED_CONTENT_TYPES` (415 otherwise) and size
    against `MAX_REPLAY_CLIP_BYTES`, measured while reading rather than
    after (`_read_capped`), the same "generous, not tight" shape
    `MAX_UPLOAD_BYTES` uses for a photograph.
    """
    _refuse_on_demo("Uploading a replay clip")

    heat = db.query(models.Heat).filter(models.Heat.id == heat_id).first()
    if heat is None or heat.race_id != race_id:
        raise HTTPException(status_code=404, detail="No such heat on this race")

    if domain_replays.is_stale(heat.recorded_at, recorded_at):
        raise HTTPException(
            status_code=409,
            detail="This heat's result has since changed, so this clip is "
            "for a run that no longer exists.",
        )

    extension = replays_service.ALLOWED_CONTENT_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported clip type: {file.content_type or 'unknown'}",
        )

    raw_bytes = await _read_capped(file, replays_service.MAX_REPLAY_CLIP_BYTES)

    filename, target_path = replays_service.store.new_clip_path(extension)
    with open(target_path, "wb") as buffer:
        buffer.write(raw_bytes)

    clip = domain_replays.ReplayClip(
        camera_id=camera_id,
        path=filename,
        race_id=race_id,
        t0_offset_ms=t0_offset_ms,
        duration_ms=duration_ms,
    )
    replays_service.store.add(
        domain_replays.ReplayKey(heat_id=heat_id, recorded_at=recorded_at), clip
    )
    # Best-effort, the same shape `record_clip` documents: a camera the
    # registry has since forgotten still gets its clip stored.
    displays_service.registry.record_clip(camera_id)
    await pubsub.publish(f"heat_replay:{race_id}", None)

    return {"url": f"/replay/{filename}"}


@app.get("/replay/{filename}")
async def get_replay_clip(filename: str) -> FileResponse:
    """Stream a stored replay clip (#177 stage 1a).

    Not `/static` — a replay never lands in `UPLOAD_DIR`, so it is served
    from its own route rather than gaining a second meaning there. The
    filename is a UUID (`ReplayStore.new_clip_path`); that is the whole of
    the access control, the same shape `/static/<filename>` already uses for
    a photograph (#552's reasoning extended to video — a video of the finish
    line is a video of children too). `Cache-Control: no-store` because
    stage 1's retention (delete-after-next-heat) can remove the file within
    seconds of it being served; a cached copy played back after that would
    be showing the wrong run.

    **Registered before the SPA catch-all below, and it must stay that
    way.** `@app.get("/{full_path:path}")` matches any GET path once
    `frontend/dist` exists — the ordinary case for every real deployment
    (`./scripts/serve.sh`, the Pi image, `install.sh`) — and FastAPI matches
    routes in registration order, so a `GET /replay/<name>` defined *after*
    that catch-all would always return `index.html` instead of the clip.
    `test_replay_route_is_registered_before_the_spa_catchall` in
    `test_replays.py` pins the order directly; the serving tests below pin
    the behaviour against a real mounted `FRONTEND_DIST`, not just an
    unmounted test app, so this cannot pass by accident on a CI environment
    that happens to have no built frontend.
    """
    directory = replays_service.store.directory.resolve()
    candidate = (directory / filename).resolve()
    if not candidate.is_relative_to(directory) or not candidate.is_file():
        raise HTTPException(status_code=404, detail="No such clip")
    media_type = "video/webm" if candidate.suffix == ".webm" else "video/mp4"
    return FileResponse(
        candidate, media_type=media_type, headers={"Cache-Control": "no-store"}
    )


def _mount_frontend(dist_dir: Path) -> None:
    """Serve a built frontend from *dist_dir*: static assets, then the SPA
    catch-all.

    A function rather than inline module-level code so a test can call it a
    second time, against a temporary directory, to prove that every route
    registered *before* this runs — `/replay/{filename}` (#177 stage 1a)
    included — still wins over the broad `GET /{full_path:path}` catch-all
    this adds, without reimporting this whole module (which real side
    effects — a database connection, timer managers — make impractical).
    See `test_replays.py`'s
    `test_a_later_mounted_spa_catchall_does_not_shadow_replay_serving`: it
    is build-independent, so it catches the same shadowing bug regardless
    of whether the checkout running it happens to have `frontend/dist` built.
    """
    app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        """Serve dist files when they exist, otherwise fall back to index.html."""
        candidate = (dist_dir / full_path).resolve()
        if candidate.is_file() and candidate.is_relative_to(dist_dir.resolve()):
            return FileResponse(candidate)
        return FileResponse(dist_dir / "index.html")


# Mount static assets if the built frontend exists
if FRONTEND_DIST.exists():
    _mount_frontend(FRONTEND_DIST)


@app.websocket("/ws/timer/{track_id}")
async def timer_websocket(websocket: WebSocket, track_id: int):
    """WebSocket endpoint for frontend-proxy timer mode.

    Operator-only when a PIN is set (#15). This socket *is* the timer on a
    proxied track: whatever connects here reports the lane times that become the
    result of a heat. Left open it is the one path where someone on the venue
    wifi could change who won, without touching a mutation — the role policy in
    `api/auth.py` guards GraphQL and this is not GraphQL.

    The PIN arrives as a query parameter for the same reason it does on the
    subscription socket: a browser cannot set headers on a WebSocket handshake.
    """
    # The demo runs a fake timer and has no port for anything to proxy, so this
    # socket has nothing to do there — and with no PIN set it is open to
    # everyone. Closed with the role code: which of the two reasons applies is
    # not a caller's business.
    if demo_mode.enabled():
        await websocket.accept()
        await websocket.close(code=4403, reason="Operator PIN required")
        return

    # Credentials before anything else, so an unauthenticated caller learns
    # nothing — not whether the track exists, nor whether proxy mode is on.
    db = SessionLocal()
    try:
        role = _role_for_request(db, websocket.query_params.get("pin"))
    finally:
        db.close()
    if role is not auth.Role.OPERATOR:
        await websocket.accept()
        await websocket.close(code=4403, reason="Operator PIN required")
        return

    if track_id not in TIMER_MANAGERS:
        await websocket.accept()
        await websocket.close(code=4000, reason="Track not found")
        return

    manager = TIMER_MANAGERS[track_id]

    # Check database to ensure proxy mode is intended for this track
    db = SessionLocal()
    try:
        track = db.query(models.Track).filter(models.Track.id == track_id).first()
        chosen_profile = None
        if not track or track.timer_type != models.TimerType.AUTO_DETECT_PROXY:
            await websocket.accept()
            await websocket.close(
                code=4000, reason="Proxy mode not enabled for this track"
            )
            return
        if track.timer_profile:
            chosen_profile = devices.by_key(track.timer_profile)
    finally:
        db.close()

    await websocket.accept()

    # A second connection for this track takes over rather than sharing it
    # silently (#301). Popped rather than merely read, so the outgoing
    # connection's own `finally` — once its receive loop eventually notices
    # the close below — finds no entry naming it and skips tearing its
    # session down a second time; see TIMER_WS_CONNECTIONS above for why that
    # matters.
    previous = TIMER_WS_CONNECTIONS.pop(track_id, None)
    if previous is not None:
        prev_websocket, prev_session = previous
        logger.info(
            "Timer %d: a new proxy connection is taking over from an existing one",
            track_id,
        )
        await prev_session.close()
        with suppress(Exception):
            await prev_websocket.close(
                code=4000, reason="Another connection took over this timer"
            )

    # Everything ordered — asking for the port, walking the candidate profiles,
    # handing the identified device to the manager — is the session's. What is
    # left here is the message encoding, which is what this endpoint is for.
    transport = WebSocketTransport(websocket.send_json, track_id)
    manager.set_write_fn(transport.send)
    # A track whose model the operator named skips the walk entirely (#143).
    session = ProxySession(manager, transport, chosen=chosen_profile)
    TIMER_WS_CONNECTIONS[track_id] = (websocket, session)
    session.start()

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "ready":
                session.on_ready()
            elif data.get("type") == "serial_rx":
                rx_bytes = base64.b64decode(data["data"])
                await session.on_bytes(rx_bytes)
            elif data.get("type") == "pong":
                # Heartbeat handled by FastAPI/Starlette usually, but we can log
                # if needed
                pass
    except WebSocketDisconnect:
        logger.info("Proxy WebSocket disconnected for track %d", track_id)
    except Exception as e:
        logger.error("WebSocket error for track %d: %s", track_id, e)
    finally:
        current = TIMER_WS_CONNECTIONS.get(track_id)
        if current is not None and current[0] is websocket:
            del TIMER_WS_CONNECTIONS[track_id]
            await session.close()


#: The largest upload this route accepts, in bytes.
#:
#: A phone photograph is a few megabytes and a HEIC burst can be more, so the
#: limit is generous rather than tight — what it exists to stop is a caller
#: naming their own size. Without it `file.read()` pulls an arbitrary body
#: straight into memory on a machine with a gigabyte of RAM.
#: Sourced from `schema.py` so the REST route and GraphQL mutations share
#: the exact same limit (#744).
MAX_UPLOAD_BYTES: int = MAX_UPLOAD_BYTES

#: How much is read at a time while checking that limit.
_UPLOAD_CHUNK = 1024 * 1024

#: The extension stored for each format Pillow can report, mirroring the
#: allowlist ``uploadImage`` (schema.py) already enforces for its GraphQL
#: twin. `convert_to_browser_safe_png` re-encodes anything outside this set
#: to PNG, so a format reaching `_sniffed_extension` unconverted is already
#: guaranteed to be one of these four — the refusal below is defence in
#: depth, not a path either caller expects to take.
_EXTENSION_FOR_FORMAT = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "GIF": ".gif",
    "WEBP": ".webp",
}


def _sniffed_extension(image_bytes: bytes) -> str:
    """Return the extension for *image_bytes*, derived from the bytes
    themselves rather than from a filename or a client-supplied content type.

    A caller naming their upload ``x.html`` on a valid small GIF must not get
    an ``.html`` back — that file is then served from `/static` as HTML on
    the app's own origin (issue #322).
    """
    fmt = Image.open(io.BytesIO(image_bytes)).format
    ext = _EXTENSION_FOR_FORMAT.get(fmt) if fmt else None
    if ext is None:
        raise HTTPException(status_code=400, detail=f"Unsupported image format: {fmt}")
    return ext


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """Read *file* up to *limit* bytes, refusing anything larger.

    Chunked rather than `await file.read()` and a length check afterwards: the
    check would happen once the whole body was already in memory, which is the
    thing being guarded against.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(_UPLOAD_CHUNK):
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/upload/")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """Upload a file and return its static URL.

    Guarded for itself, like the backup routes and the timer socket: the role
    policy covers GraphQL mutations and this is not one (#15). At ``CHECKIN``
    rather than ``OPERATOR`` because its GraphQL twin ``uploadImage`` is a
    check-in mutation, and photographing a car is the desk's job.

    Nothing in the frontend calls this — images go through ``uploadImage`` as a
    data URL — but it is a documented endpoint (`docs/design.md` §3.3) and it
    wrote a permanent file from an unauthenticated request until this check
    existed. The suite's data directory reached 8,000 files and 3.5 GB before
    anybody looked at what nothing was deleting; see `tests/conftest.py`.
    """
    _refuse_on_demo("Uploading images")
    _require_checkin(request, db)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing")

    raw_bytes = await _read_capped(file, MAX_UPLOAD_BYTES)
    try:
        image_bytes = convert_to_browser_safe_png(raw_bytes)
    except UnreadableImageError as error:
        # A corrupt or truncated upload (flaky venue wifi, a half-written
        # camera capture) used to reach here as an uncaught
        # `PIL.UnidentifiedImageError` and surface as a raw 500 (#885).
        raise HTTPException(status_code=400, detail=str(error)) from error

    # The stored extension comes from the sniffed image content, never from
    # the caller-supplied filename (#322) — a filename claiming `.html` on a
    # small, browser-native GIF/JPEG polyglot must not end up served as HTML
    # from this app's own origin.
    ext = ".png" if image_bytes is not raw_bytes else _sniffed_extension(image_bytes)

    filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        buffer.write(image_bytes)

    return {"url": f"/static/{filename}"}
