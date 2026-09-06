"""
Trusty Track — desktop entry point.

Runs the FastAPI/uvicorn server in a background thread and shows a
platform-native status icon so the user can manage the server without
needing a terminal:
  - macOS  : rumps menu-bar icon
  - Windows: pystray system-tray icon
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime
import ipaddress
import json
import logging
import os
import platform
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

# Sibling modules, not `packaging.log_viewer` / `packaging.http_mode`: this
# script has no package `__init__.py` (nor should it — PyPI's own `packaging`
# library is a common transitive dependency, and a real package here would
# shadow or collide with it). Python and PyInstaller both resolve a bare
# `import log_viewer` against this script's own directory, which is the
# ordinary way a launcher script keeps a helper module beside it.
import cert_requirements
import http_mode
from log_viewer import build_view_logs_command, console_app_available

try:
    from backend.version import __version__ as version

    TT_VERSION = version
except ImportError:
    TT_VERSION = "unknown"

# ── Platform data directory ────────────────────────────────────────────────────


def _get_data_dir() -> Path:
    system = platform.system()
    if system == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "TrustyTrack"
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", str(Path.home()))) / "TrustyTrack"
    else:
        base = Path.home() / ".trustytrack"
    base.mkdir(parents=True, exist_ok=True)
    return base


DATA_DIR = _get_data_dir()
LOG_PATH = DATA_DIR / "server.log"
DB_PATH = DATA_DIR / "trusty-track.db"
CERT_PATH = DATA_DIR / "server.crt"
KEY_PATH = DATA_DIR / "server.key"
SETTINGS_PATH = DATA_DIR / "launcher_settings.json"
PORT = int(os.environ.get("PORT", "8000"))

# Must be set before importing backend (database.py reads it at import time).
os.environ.setdefault("TRUSTYTRACK_DATA_DIR", str(DATA_DIR))

# ── Plain HTTP vs HTTPS (#593) ──────────────────────────────────────────────
#
# `TRUSTYTRACK_HTTP_ONLY`, if set, always wins — that is what lets
# `scripts/serve.sh`, the Pi's systemd unit and a test override the choice
# without touching this file. Absent, the launcher falls back to whatever the
# tray/menu-bar toggle last persisted to `SETTINGS_PATH`; a fresh install has
# neither, and gets HTTPS, exactly as every install did before this existed.


def _read_persisted_http_only() -> bool:
    try:
        data = json.loads(SETTINGS_PATH.read_text())
    except (OSError, ValueError):
        return False
    return bool(data.get("http_only", False))


def _write_persisted_http_only(value: bool) -> None:
    SETTINGS_PATH.write_text(json.dumps({"http_only": value}))


_HTTP_TOGGLE_LABEL = "Use Plain HTTP (no certificate warnings)"


def _http_restart_message(new_value: bool) -> str:
    # Not an in-process restart: APP_URL, NETWORK_URL and whether a
    # certificate is generated are all resolved once, above, before uvicorn
    # or the backend are even imported — changing them under a running
    # server would mean re-deriving every one of those live and reopening
    # whatever browser tab is already pointed at the old scheme. Asking for
    # a full quit-and-reopen is the honest version of "restart required".
    mode = "plain HTTP" if new_value else "HTTPS"
    return (
        f"Trusty Track will use {mode} the next time it starts.\n\n"
        "Quit and reopen Trusty Track for this to take effect."
    )


_env_http_only = os.environ.get(http_mode.HTTP_ONLY_VARIABLE)
HTTP_ONLY = (
    http_mode.http_only_enabled(_env_http_only)
    if _env_http_only is not None
    else _read_persisted_http_only()
)

# Always log to file; on frozen builds stderr is /dev/null anyway.
logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# ── SSL context for health-check (skips self-signed cert verification) ─────────

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def _health_check_kwargs() -> dict[str, ssl.SSLContext]:
    """`urlopen`'s extra kwargs for polling `/health`.

    `context` is simply ignored for a plain `http://` URL, so passing it
    unconditionally would work — but a reader seeing an SSL context handed to
    an HTTP request would reasonably wonder why, and plain-HTTP mode is the
    one case with a real answer: there is no certificate to skip verifying.
    """
    return {} if HTTP_ONLY else {"context": _SSL_CTX}


# ── Networking helpers ─────────────────────────────────────────────────────────


def _get_local_ip() -> str:
    """Return the primary outbound network IP (not loopback)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        with contextlib.suppress(Exception):
            s.close()


# ── Self-signed certificate generation ────────────────────────────────────────


def _cert_is_valid() -> bool:
    """Return True if the cert exists, has not expired, and covers every
    name #723 needs (see `cert_requirements.py`) — an install upgrading
    into that requirement holds a certificate that predates it, and the
    cache is otherwise good for the full ten-year lifetime below."""
    if not CERT_PATH.exists() or not KEY_PATH.exists():
        return False
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend

        cert = x509.load_pem_x509_certificate(CERT_PATH.read_bytes(), default_backend())
        if cert.not_valid_after_utc <= datetime.datetime.now(datetime.timezone.utc):
            return False
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        dns_names = san.value.get_values_for_type(x509.DNSName)
        return cert_requirements.covers_required_names(dns_names)
    except Exception:
        return False


def _ensure_cert() -> None:
    """Generate a self-signed TLS certificate covering localhost, the LAN
    IP, and the mDNS hostname (#723) `backend/services/discovery.py` asks to
    be advertised as."""
    if _cert_is_valid():
        return

    logging.info("Generating self-signed TLS certificate…")
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    local_ip = _get_local_ip()
    san_entries: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.DNSName(cert_requirements.MDNS_HOSTNAME),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    if local_ip != "127.0.0.1":
        with contextlib.suppress(ValueError):
            san_entries.append(x509.IPAddress(ipaddress.IPv4Address(local_ip)))

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "TrustyTrack"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "TrustyTrack"),
        ]
    )

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(
            datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650)
        )
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    KEY_PATH.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    CERT_PATH.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    logging.info("Certificate written to %s", CERT_PATH)


# Generate the cert before importing the backend (uvicorn needs the files) —
# skipped entirely in plain-HTTP mode, where there is nothing to generate.
if http_mode.needs_certificate(HTTP_ONLY):
    _ensure_cert()

LOCAL_IP = _get_local_ip()
_SCHEME = http_mode.scheme(HTTP_ONLY)
APP_URL = f"{_SCHEME}://localhost:{PORT}"
NETWORK_URL = f"{_SCHEME}://{LOCAL_IP}:{PORT}"

# ── Backend imports (after env vars are set) ───────────────────────────────────

import uvicorn  # noqa: E402

from backend.api import main as _backend_main  # noqa: E402
from backend.api.main import app as _app  # noqa: E402


def _network_label() -> str:
    """`NETWORK_URL`, plus the mDNS hostname (#723) once registration has
    resolved, for the tray/menu-bar's own "Network:" row.

    `_backend_main.MDNS_RESPONDER` is set inside the FastAPI lifespan,
    which has already completed by the time `ServerController._poll_ready`
    sees a 200 from `/health` — so this is meaningful from the moment the
    tray first reports "running", and otherwise just falls back to the
    plain `NETWORK_URL` this row has always shown (mDNS declined, or the
    server has not finished starting yet). Read fresh on every call rather
    than cached, since the macOS tray calls this once per status change and
    the Windows one calls it fresh on every menu open — see each `run()`
    below.
    """
    responder = _backend_main.MDNS_RESPONDER
    if responder is None:
        return f"Network: {NETWORK_URL}"
    return f"Network: {NETWORK_URL} (or {_SCHEME}://{responder.hostname}:{PORT})"


# ── Server controller ─────────────────────────────────────────────────────────


class ServerController:
    """Starts and stops a uvicorn server in a dedicated background thread."""

    def __init__(self) -> None:
        self._server = None
        self._thread = None
        self.status = "stopped"
        self.on_status_change = None

    def _notify(self, status: str) -> None:
        self.status = status
        if self.on_status_change:
            self.on_status_change(status)

    def start(self) -> None:
        self._notify("starting")
        config = uvicorn.Config(
            _app,
            host="0.0.0.0",
            port=PORT,
            log_level="info",
            **http_mode.uvicorn_ssl_kwargs(HTTP_ONLY, CERT_PATH, KEY_PATH),
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        threading.Thread(target=self._poll_ready, daemon=True).start()

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._server.serve())
        self._notify("stopped")

    def _poll_ready(self) -> None:
        for _ in range(60):
            if self._server and self._server.should_exit:
                self._notify("error")
                return
            try:
                with urllib.request.urlopen(
                    f"{APP_URL}/health", timeout=1, **_health_check_kwargs()
                ) as r:
                    if r.status == 200:
                        self._notify("running")
                        return
            except Exception:
                pass
            time.sleep(0.5)
        self._notify("error")

    def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._thread:
            self._thread.join(timeout=10)
        self._notify("stopped")

    def restart(self) -> None:
        self.stop()
        time.sleep(0.5)
        self.start()


# ── Shared helpers ─────────────────────────────────────────────────────────────


def _icon_path() -> Path | None:
    if getattr(sys, "frozen", False):
        p = Path(sys._MEIPASS) / "assets" / "logo_transparent.png"
    else:
        p = (
            Path(__file__).parent.parent
            / "frontend"
            / "src"
            / "assets"
            / "logo_transparent.png"
        )
    return p if p.exists() else None


_STATUS_LABEL: dict[str, str] = {
    "starting": "Server: Starting…",
    "running": "Server: Running",
    "stopped": "Server: Stopped",
    "error": "Server: Error",
}


# ── macOS: rumps menu-bar app ──────────────────────────────────────────────────

if sys.platform == "darwin":
    import rumps  # noqa: E402

    class TrustyTrackApp(rumps.App):
        """macOS menu-bar status icon."""

        def __init__(self, controller: ServerController) -> None:
            p = _icon_path()
            super().__init__(
                "TrustyTrack", icon=str(p) if p else None, quit_button=None
            )
            self._controller = controller
            self._status_item = rumps.MenuItem(_STATUS_LABEL["starting"])
            self._network_item = rumps.MenuItem(_network_label())
            self._http_only_item = rumps.MenuItem(
                _HTTP_TOGGLE_LABEL, callback=self._toggle_http_only
            )
            self._http_only_item.state = HTTP_ONLY

            self.menu = [
                rumps.MenuItem("Open App in Browser", callback=self._open_browser),
                None,
                self._status_item,
                self._network_item,
                None,
                rumps.MenuItem("Restart Server", callback=self._restart),
                rumps.MenuItem("Reset Database…", callback=self._reset_db),
                self._http_only_item,
                rumps.MenuItem("View Logs", callback=self._view_logs),
                None,
                rumps.MenuItem(f"Trusty Track v{TT_VERSION}", callback=None),
                rumps.MenuItem("Quit TrustyTrack", callback=self._quit),
            ]

            controller.on_status_change = self._update_status

        def _update_status(self, status: str) -> None:
            self._status_item.title = _STATUS_LABEL.get(
                status, f"Server: {status.capitalize()}"
            )
            # The mDNS hostname (#723) is only known once the lifespan has
            # run — refreshed on every status change rather than only
            # "running" so a restart's fresh registration is picked up too.
            self._network_item.title = _network_label()

        def _open_browser(self, _) -> None:
            webbrowser.open(APP_URL)

        def _restart(self, _) -> None:
            threading.Thread(target=self._controller.restart, daemon=True).start()

        def _toggle_http_only(self, _) -> None:
            new_value = not _read_persisted_http_only()
            _write_persisted_http_only(new_value)
            self._http_only_item.state = new_value
            rumps.alert(
                title="Restart Required", message=_http_restart_message(new_value)
            )

        def _reset_db(self, _) -> None:
            resp = rumps.alert(
                title="Reset Database",
                message=(
                    "This will permanently delete all race data and cannot be undone."
                    "\n\nContinue?"
                ),
                ok="Reset",
                cancel="Cancel",
            )
            if resp.clicked:

                def _do() -> None:
                    self._controller.stop()
                    if DB_PATH.exists():
                        DB_PATH.unlink()
                    self._controller.start()

                threading.Thread(target=_do, daemon=True).start()

        def _view_logs(self, _) -> None:
            LOG_PATH.touch(exist_ok=True)
            command = build_view_logs_command(
                "Darwin", LOG_PATH, console_available=console_app_available()
            )
            subprocess.run(command, check=False)

        def _quit(self, _) -> None:
            threading.Thread(target=self._controller.stop, daemon=True).start()
            time.sleep(0.5)
            rumps.quit_application()


# ── Windows: pystray system-tray app ──────────────────────────────────────────

elif sys.platform == "win32":
    import pystray  # noqa: E402
    from PIL import Image  # noqa: E402

    class TrustyTrackApp:
        """Windows system-tray icon."""

        def __init__(self, controller: ServerController) -> None:
            self._controller = controller
            self._status = "starting"
            self._icon_obj = None
            controller.on_status_change = self._update_status

        def _update_status(self, status: str) -> None:
            self._status = status
            # pystray re-reads callable titles each time the menu opens.

        def _get_status_label(self) -> str:
            return _STATUS_LABEL.get(
                self._status, f"Server: {self._status.capitalize()}"
            )

        def _load_image(self) -> Image.Image:
            p = _icon_path()
            if p:
                try:
                    return Image.open(p).convert("RGBA")
                except Exception:
                    pass
            # Fallback: plain scouting-blue square.
            img = Image.new("RGBA", (64, 64), (0, 63, 135, 255))
            return img

        # ── Callbacks (pystray passes (icon, item)) ────────────────────────────

        def _open_browser(self, _icon, _item) -> None:
            webbrowser.open(APP_URL)

        def _restart(self, _icon, _item) -> None:
            threading.Thread(target=self._controller.restart, daemon=True).start()

        def _http_only_checked(self, _item) -> bool:
            # Re-read on every menu open, the same shape `_get_status_label`
            # uses — pystray calls this each time rather than caching it.
            return _read_persisted_http_only()

        def _toggle_http_only(self, _icon, _item) -> None:
            import ctypes

            mb_iconinformation = 0x40
            new_value = not _read_persisted_http_only()
            _write_persisted_http_only(new_value)
            ctypes.windll.user32.MessageBoxW(
                0,
                _http_restart_message(new_value),
                "Restart Required",
                mb_iconinformation,
            )

        def _reset_db(self, _icon, _item) -> None:
            import ctypes

            mb_yesno = 0x04
            mb_iconwarning = 0x30
            idyes = 6
            result = ctypes.windll.user32.MessageBoxW(
                0,
                (
                    "This will permanently delete all race data and cannot be undone."
                    "\n\nContinue?"
                ),
                "Reset Database",
                mb_yesno | mb_iconwarning,
            )
            if result == idyes:

                def _do() -> None:
                    self._controller.stop()
                    if DB_PATH.exists():
                        DB_PATH.unlink()
                    self._controller.start()

                threading.Thread(target=_do, daemon=True).start()

        def _view_logs(self, _icon, _item) -> None:
            LOG_PATH.touch(exist_ok=True)
            command = build_view_logs_command("Windows", LOG_PATH)
            # A new, visible console window, not the tray process's own
            # (invisible) one — CREATE_NEW_CONSOLE is what `os.startfile`
            # gave Notepad for free, and PowerShell has no window otherwise.
            subprocess.Popen(command, creationflags=subprocess.CREATE_NEW_CONSOLE)

        def _quit(self, icon, _item) -> None:
            icon.stop()

        def run(self) -> None:
            menu = pystray.Menu(
                pystray.MenuItem(
                    "Open App in Browser", self._open_browser, default=True
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(lambda _item: self._get_status_label(), None),
                # pystray re-reads a callable title each time the menu
                # opens, the same as the status label above — which is what
                # lets this pick up the mDNS hostname (#723) once
                # registration resolves, with no explicit refresh to wire.
                pystray.MenuItem(lambda _item: _network_label(), None),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Restart Server", self._restart),
                pystray.MenuItem("Reset Database…", self._reset_db),
                pystray.MenuItem(
                    _HTTP_TOGGLE_LABEL,
                    self._toggle_http_only,
                    checked=self._http_only_checked,
                ),
                pystray.MenuItem("View Logs", self._view_logs),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(f"Trusty Track v{TT_VERSION}", None),
                pystray.MenuItem("Quit TrustyTrack", self._quit),
            )
            self._icon_obj = pystray.Icon(
                "TrustyTrack", self._load_image(), "TrustyTrack", menu
            )
            self._icon_obj.run()


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if getattr(sys, "frozen", False) and sys._MEIPASS not in sys.path:
        # This is PyInstaller's working directory. Ensure it is in sys.path
        # so that our backend.api imports work when run from Finder.
        sys.path.insert(0, sys._MEIPASS)

    try:
        controller = ServerController()
        controller.start()

        # Open the browser once on first successful startup.
        def _auto_open() -> None:
            for _ in range(60):
                try:
                    with urllib.request.urlopen(
                        f"{APP_URL}/health", timeout=1, **_health_check_kwargs()
                    ) as r:
                        if r.status == 200:
                            webbrowser.open(APP_URL)
                            return
                except Exception:
                    pass
                time.sleep(0.5)

        threading.Thread(target=_auto_open, daemon=True).start()

        TrustyTrackApp(controller).run()

        controller.stop()
    except Exception as e:
        import traceback

        error_msg = f"Error during startup: {str(e)}\n" + traceback.format_exc()

        # Log to /tmp/ for system visibility
        with (
            contextlib.suppress(Exception),
            open("/tmp/trustytrack_startup_error.log", "w") as f,
        ):
            f.write(error_msg)

        # Log to user home for easy access
        with contextlib.suppress(Exception):
            home_log = os.path.expanduser("~/trusty_error.log")
            with open(home_log, "w") as f:
                f.write(error_msg)
        raise
