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
import logging
import os
import platform
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

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
DB_PATH  = DATA_DIR / "trusty-track.db"
PORT     = int(os.environ.get("PORT", "8000"))
APP_URL  = f"http://localhost:{PORT}"

# Must be set before importing backend (database.py reads it at import time).
os.environ.setdefault("TRUSTYTRACK_DATA_DIR", str(DATA_DIR))

# Always log to file; on frozen builds stderr is /dev/null anyway.
logging.basicConfig(
    filename=str(LOG_PATH),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# ── Backend imports (after env var is set) ─────────────────────────────────────

import uvicorn                          # noqa: E402
from backend.main import app as _app   # noqa: E402

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
        config = uvicorn.Config(_app, host="0.0.0.0", port=PORT, log_level="info")
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
                with urllib.request.urlopen(f"{APP_URL}/health", timeout=1) as r:
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
        p = Path(__file__).parent.parent / "frontend" / "src" / "assets" / "logo_transparent.png"
    return p if p.exists() else None


_STATUS_LABEL: dict[str, str] = {
    "starting": "Server: Starting…",
    "running":  "Server: Running",
    "stopped":  "Server: Stopped",
    "error":    "Server: Error",
}


# ── macOS: rumps menu-bar app ──────────────────────────────────────────────────

if sys.platform == "darwin":
    import rumps  # noqa: E402

    class TrustyTrackApp(rumps.App):
        """macOS menu-bar status icon."""

        def __init__(self, controller: ServerController) -> None:
            p = _icon_path()
            super().__init__("TrustyTrack", icon=str(p) if p else None, quit_button=None)
            self._controller = controller
            self._status_item = rumps.MenuItem(_STATUS_LABEL["starting"])

            self.menu = [
                rumps.MenuItem("Open App in Browser", callback=self._open_browser),
                None,
                self._status_item,
                None,
                rumps.MenuItem("Restart Server",  callback=self._restart),
                rumps.MenuItem("Reset Database…", callback=self._reset_db),
                rumps.MenuItem("View Logs",        callback=self._view_logs),
                None,
                rumps.MenuItem("Quit TrustyTrack", callback=self._quit),
            ]

            controller.on_status_change = self._update_status

        def _update_status(self, status: str) -> None:
            self._status_item.title = _STATUS_LABEL.get(
                status, f"Server: {status.capitalize()}"
            )

        def _open_browser(self, _) -> None:
            webbrowser.open(APP_URL)

        def _restart(self, _) -> None:
            threading.Thread(target=self._controller.restart, daemon=True).start()

        def _reset_db(self, _) -> None:
            resp = rumps.alert(
                title="Reset Database",
                message="This will permanently delete all race data and cannot be undone.\n\nContinue?",
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
            subprocess.run(["open", str(LOG_PATH)], check=False)

        def _quit(self, _) -> None:
            threading.Thread(target=self._controller.stop, daemon=True).start()
            time.sleep(0.5)
            rumps.quit_application()


# ── Windows: pystray system-tray app ──────────────────────────────────────────

elif sys.platform == "win32":
    import pystray          # noqa: E402
    from PIL import Image   # noqa: E402

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
            return _STATUS_LABEL.get(self._status, f"Server: {self._status.capitalize()}")

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

        def _open_browser(self, icon, item) -> None:
            webbrowser.open(APP_URL)

        def _restart(self, icon, item) -> None:
            threading.Thread(target=self._controller.restart, daemon=True).start()

        def _reset_db(self, icon, item) -> None:
            import ctypes
            MB_YESNO      = 0x04
            MB_ICONWARNING = 0x30
            IDYES = 6
            result = ctypes.windll.user32.MessageBoxW(
                0,
                "This will permanently delete all race data and cannot be undone.\n\nContinue?",
                "Reset Database",
                MB_YESNO | MB_ICONWARNING,
            )
            if result == IDYES:
                def _do() -> None:
                    self._controller.stop()
                    if DB_PATH.exists():
                        DB_PATH.unlink()
                    self._controller.start()
                threading.Thread(target=_do, daemon=True).start()

        def _view_logs(self, icon, item) -> None:
            LOG_PATH.touch(exist_ok=True)
            os.startfile(str(LOG_PATH))

        def _quit(self, icon, item) -> None:
            icon.stop()

        def run(self) -> None:
            menu = pystray.Menu(
                pystray.MenuItem(
                    "Open App in Browser", self._open_browser, default=True
                ),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(lambda item: self._get_status_label(), None),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Restart Server",  self._restart),
                pystray.MenuItem("Reset Database…", self._reset_db),
                pystray.MenuItem("View Logs",        self._view_logs),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quit TrustyTrack", self._quit),
            )
            self._icon_obj = pystray.Icon(
                "TrustyTrack", self._load_image(), "TrustyTrack", menu
            )
            self._icon_obj.run()


# ── Main ──────────────────────────────────────────────────────────────────────

controller = ServerController()
controller.start()

# Open the browser once on first successful startup.
def _auto_open() -> None:
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"{APP_URL}/health", timeout=1) as r:
                if r.status == 200:
                    webbrowser.open(APP_URL)
                    return
        except Exception:
            pass
        time.sleep(0.5)

threading.Thread(target=_auto_open, daemon=True).start()

TrustyTrackApp(controller).run()

controller.stop()
